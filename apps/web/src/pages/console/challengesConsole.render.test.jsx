// THE GYM'S CHALLENGES IN THE CONSOLE, drawn (ROADMAP 19d-i; spec Part 3 §15.6). Only the
// network is mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: cancel a challenge staff did not pick, or without
// the box that says what members will see — so the press is checked against the challenge
// it was made on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GYM_CHALLENGE_WORDS } from '@app/shared';
import { closureDateLabel } from './hoursView';

const svc = { list: vi.fn(), board: vi.fn(), add: vi.fn(), change: vi.fn(), setCancelled: vi.fn(), setScores: vi.fn() };
const orgApi = { getMine: vi.fn() };
vi.mock('../../api/challengesApi', () => ({ staffChallengesService: svc }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});

const Challenges = (await import('./Challenges')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'leaderboard.manage'],
  timezone: 'Asia/Kolkata',
  clockFormat: '24h',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const challenge = (id, name, over = {}) => ({
  id,
  name,
  details: '',
  prize: '',
  counts: 'gym_days',
  startsOn: '2026-10-05',
  endsOn: '2026-10-11',
  target: null,
  who: 'everyone',
  unit: '',
  lowestWins: false,
  cancelled: false,
  state: 'running',
  joinedCount: null,
  ...over,
});
const listOf = (current = [], over = {}) => ({ gymId: 'g1', gymName: 'Iron House', timezone: 'Asia/Kolkata', today: '2026-10-07', checkingIn: true, inApp: 143, current, past: [], pastTotal: 0, ...over });
const row = (id, name, place, value, over = {}) => ({ userId: id, name, initials: name === null ? '?' : name.slice(0, 1), place, value, hidden: null, reached: false, ...over });
const boardOf = (rows, over = {}) => ({ challengeId: 'a', memberStatus: 'shown', ranked: rows.filter((r) => r.place !== null).length, total: rows.length, hidden: rows.filter((r) => r.hidden !== null).length, reached: null, page: 1, pages: 1, rows, asOf: '2026-10-07T06:30:00.000Z', ...over });

const open = (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/challenges']}>
      <Routes>
        <Route path="/console/:orgSlug/challenges" element={<Challenges />} />
      </Routes>
    </MemoryRouter>,
  );
};
const cards = () => screen.queryAllByTestId('challenge');
/** A challenge's own page: opened from its row on the list (going back to the list first
 *  when another one is open). */
const cardOf = (name) => {
  const detail = screen.queryByTestId('challenge-detail');
  if (detail !== null && within(detail).queryByRole('heading', { name }) !== null) return detail;
  if (detail !== null) fireEvent.click(within(detail).getByRole('button', { name: 'All challenges' }));
  fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }));
  return screen.getByTestId('challenge-detail');
};
const backToList = () => fireEvent.click(within(screen.getByTestId('challenge-detail')).getByRole('button', { name: 'All challenges' }));
const form = () => within(screen.getByTestId('challenge-form'));
const refusal = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });

/** Pick a date the way a person does: open the calendar under the box named `label`, go
 *  forward a month at a time until the day is there, press it. */
const pickDate = (label, day) => {
  fireEvent.click(form().getByRole('button', { name: label }));
  const dayName = closureDateLabel(day);
  for (let n = 0; n < 24 && screen.queryByRole('button', { name: dayName }) === null; n += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  }
  fireEvent.click(screen.getByRole('button', { name: dayName }));
};
const type = (label, text) => fireEvent.change(form().getByLabelText(label), { target: { value: text } });
const pick = (group, title) => fireEvent.click(within(form().getByRole('radiogroup', { name: group })).getByRole('radio', { name: new RegExp(`^${title}`) }));
const picked = (group) => within(form().getByRole('radiogroup', { name: group })).getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')?.textContent;
const openAdd = async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Add challenge' }));
};

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
  orgApi.getMine.mockReset();
  resetConsoleOrgs();
  svc.list.mockResolvedValue(listOf());
});
afterEach(() => cleanup());

describe("the console's Challenges page", () => {
  it('with none, says what a challenge is and where to press', async () => {
    open();
    expect(await screen.findByText('No challenge is running or coming up.')).toBeTruthy();
    expect(screen.getByText(/A challenge is a contest with a start and an end/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add challenge' })).toBeTruthy();
    expect(svc.list).toHaveBeenCalledWith('g1');
  });

  it('draws each challenge: its tag, days, how it is won, who is in it and its prize', async () => {
    svc.list.mockResolvedValue(
      listOf([
        challenge('a', 'October Week', {
          target: 5,
          prize: 'A shaker',
          details: 'Any five days.',
          withNumber: 12,
          top: [
            { userId: 'u1', name: 'Priya Sharma', initials: 'PS', place: 1, value: 3 },
            { userId: 'u2', name: 'Neha Kapoor', initials: 'NK', place: 2, value: 2 },
            { userId: 'u3', name: 'Arjun Mehta', initials: 'AM', place: 2, value: 2 },
          ],
        }),
        challenge('b', 'Next Week', { state: 'coming', startsOn: '2026-10-12', endsOn: '2026-10-18', who: 'joined', joinedCount: 24, counts: 'workout_days' }),
      ]),
    );
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    const a = within(cardOf('October Week'));
    expect(a.getByText('Running · 5 days left')).toBeTruthy();
    expect(a.getByText('Mon 5 Oct – Sun 11 Oct · 7 days')).toBeTruthy();
    expect(within(a.getByTestId('challenge-facts')).getAllByRole('term').map((t) => t.textContent)).toEqual(['Counts', 'How it is won', 'Who is in it']);
    expect(within(a.getByTestId('challenge-facts')).getAllByRole('definition').map((d) => d.textContent)).toEqual(['Gym days', 'Counted by the app', 'Reach 5 gym days', 'Everyone who gets there wins', 'Everyone in the app', '143 people']);
    expect(a.getByText('Prize: A shaker')).toBeTruthy();
    expect(a.getByText('Any five days.')).toBeTruthy();
    // How far through it is, how many have a number, and the first three with their places.
    const days = within(a.getByTestId('challenge-days'));
    expect(days.getByText('Day 3 of 7')).toBeTruthy();
    expect(days.getByText('12 people have a gym day')).toBeTruthy();
    expect(days.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('43');
    expect(within(a.getByRole('list', { name: 'In the lead: October Week' })).getAllByRole('listitem').map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual(['1stPriya Sharma3 gym days', '2ndNeha Kapoor2 gym days', '2ndArjun Mehta2 gym days']);
    const b = within(cardOf('Next Week'));
    // Not started: no bar and nobody in the lead.
    expect(b.queryByTestId('challenge-days')).toBeNull();
    expect(b.queryByRole('list', { name: /In the lead/ })).toBeNull();
    expect(b.getByText('Starts in 5 days')).toBeTruthy();
    expect(within(b.getByTestId('challenge-facts')).getAllByRole('definition').map((d) => d.textContent)).toEqual(['Workout days', 'Counted by the app', 'Most workout days wins', 'Equal numbers share a place', 'Members who join', '24 people have joined']);
    expect(b.getByRole('button', { name: 'See who has joined: Next Week' })).toBeTruthy();
    // Back on the list: a line a challenge, each with who is leading and its way in.
    backToList();
    expect(screen.getByText('Running and coming up (2)')).toBeTruthy();
    expect(cards().map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'October WeekRunning · 5 days leftMon 5 Oct – Sun 11 Oct · 7 daysReach 5 gym days · Everyone in the app · 143 peoplePriya Sharma · 3 gym daysIn the leadPriya Sharma · 3 gym daysOpen',
      'Next WeekStarts in 5 daysMon 12 Oct – Sun 18 Oct · 7 daysMost workout days wins · Members who join · 24 people have joinedOpen',
    ]);
  });

  it('adds a challenge from the form: every choice says what it means, and what is sent is what was picked', async () => {
    svc.add.mockImplementation(async (_gym, _key, fields) => challenge('new', fields.name, { ...fields, state: 'coming', joinedCount: 0 }));
    await openAdd();
    // It opens on the commonest challenge.
    expect(picked('Who counts it')).toBe('The appIt counts gym check-ins or workouts by itself. Nothing for your staff to do.');
    expect(picked('What the app counts')).toBe('Gym daysA day a member is checked in, at your front desk or by your staff. Two visits in one day count once.');
    expect(picked('How it is won')).toBe('Most gym days winsThe member with the most gym days when it ends comes 1st.');
    expect(picked('Who is in it')).toContain('Everyone in the app');
    expect(form().getByText('Everybody using the app is in it: 143 people. Nobody has to do anything.')).toBeTruthy();
    expect(form().queryByLabelText(/^Target/)).toBeNull();

    type('Challenge name', '  Autumn Twelve ');
    pick('What the app counts', 'Workout days');
    // The choices follow what is counted.
    expect(picked('How it is won')).toBe('Most workout days winsThe member with the most workout days when it ends comes 1st.');
    pickDate('First day', '2026-10-12');
    pickDate('Last day', '2026-11-08');
    pick('How it is won', 'Reach a target');
    expect(form().getByText('You set the target, such as 12 workout days. Everyone who reaches it wins.')).toBeTruthy();
    expect(form().getByText('One workout day a day is the most anybody can get, and this challenge is 28 days long: 28 is the highest number that can be reached.')).toBeTruthy();
    // The box's number is a number of something, said beside it.
    expect(form().getByTestId('target-unit').textContent).toBe('workout days');
    type('Target, in workout days', '12');
    pick('Who is in it', 'Only people who join');
    type('Prize (optional)', 'A free month');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));

    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    const [gymId, key, fields] = svc.add.mock.calls[0];
    expect(gymId).toBe('g1');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(fields).toEqual({ name: 'Autumn Twelve', details: '', prize: 'A free month', unit: '', counts: 'workout_days', startsOn: '2026-10-12', endsOn: '2026-11-08', target: 12, who: 'joined', lowestWins: false, teams: 'none', teamList: [] });
    expect((await screen.findByRole('status')).textContent).toBe('Challenge added. Your members can see it now.');
    expect(screen.queryByTestId('challenge-form')).toBeNull();
    expect(svc.change).not.toHaveBeenCalled();
  });

  it('says what is wrong before anything is sent, and the server\'s own words when it refuses', async () => {
    await openAdd();
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    expect(form().getByRole('alert').textContent).toBe('Give the challenge a name.');
    type('Challenge name', 'October');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    expect(form().getByRole('alert').textContent).toBe('Pick its first day.');
    pickDate('First day', '2026-10-08');
    pickDate('Last day', '2026-10-14');
    pick('How it is won', 'Reach a target');
    type('Target, in gym days', '8');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    expect(form().getByRole('alert').textContent).toBe('One a day is counted and this challenge is 7 days long, so the most anyone can reach is 7. Type 7 or less, or make it longer.');
    expect(svc.add).not.toHaveBeenCalled();

    type('Target, in gym days', '7');
    svc.add.mockRejectedValueOnce(refusal(409, GYM_CHALLENGE_WORDS.full));
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    await waitFor(() => expect(form().getByRole('alert').textContent).toBe(GYM_CHALLENGE_WORDS.full));
    // The form is still there with what was typed.
    expect(form().getByLabelText('Challenge name').value).toBe('October');
  });

  it('a save whose reply was lost and whose form then changed is sent again as a change to the one kept', async () => {
    await openAdd();
    type('Challenge name', 'October');
    pickDate('First day', '2026-10-08');
    pickDate('Last day', '2026-10-14');
    svc.add.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    await waitFor(() => expect(form().getByRole('alert').textContent).toMatch(/^Couldn't reach the server/));
    type('Challenge name', 'October Week');
    // The first press was kept: the server answers the same key with "October".
    svc.add.mockResolvedValueOnce(challenge('kept', 'October', { startsOn: '2026-10-08', endsOn: '2026-10-14', state: 'coming' }));
    svc.change.mockResolvedValueOnce(challenge('kept', 'October Week', { startsOn: '2026-10-08', endsOn: '2026-10-14', state: 'coming' }));
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(1));
    expect(svc.add.mock.calls[0][1]).toBe(svc.add.mock.calls[1][1]);
    expect(svc.change.mock.calls[0].slice(0, 2)).toEqual(['g1', 'kept']);
    expect(svc.change.mock.calls[0][2].name).toBe('October Week');
  });

  it('a gym that checks nobody in is warned under Gym days, and not under Workout days', async () => {
    svc.list.mockResolvedValue(listOf([], { checkingIn: false }));
    await openAdd();
    expect(form().getByRole('note').textContent).toMatch(/^Nobody has been checked in at your front desk in the last 30 days\./);
    pick('What the app counts', 'Workout days');
    expect(form().queryByRole('note')).toBeNull();
    // Nor where the staff count: no gym day is needed.
    pick('What the app counts', 'Gym days');
    expect(form().getByRole('note')).toBeTruthy();
    pick('Who counts it', 'Your staff');
    expect(form().queryByRole('note')).toBeNull();
  });

  it('editing one that has started: the four things that cannot change are switched off and said, the rest saves', async () => {
    const running = challenge('a', 'October Week', { target: 5, who: 'joined', joinedCount: 3 });
    svc.list.mockResolvedValue(listOf([running]));
    svc.change.mockImplementation(async (_gym, id, fields) => ({ ...running, ...fields, id }));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(within(cardOf('October Week')).getByRole('button', { name: 'Edit October Week' }));
    expect(form().getByTestId('locked-note').textContent).toMatch(/^This challenge has started/);
    for (const group of ['Who counts it', 'What the app counts', 'How it is won', 'Who is in it']) {
      for (const radio of within(form().getByRole('radiogroup', { name: group })).getAllByRole('radio')) expect(radio.disabled).toBe(true);
    }
    expect(form().getByLabelText('Target, in gym days').disabled).toBe(true);
    expect(form().getByRole('button', { name: 'First day' }).disabled).toBe(true);
    expect(form().getByRole('button', { name: 'Last day' }).disabled).toBe(false);

    type('Challenge name', 'October Fortnight');
    type('Prize (optional)', 'A towel');
    pickDate('Last day', '2026-10-18');
    fireEvent.click(form().getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(1));
    expect(svc.change.mock.calls[0]).toEqual(['g1', 'a', { name: 'October Fortnight', details: '', prize: 'A towel', unit: '', counts: 'gym_days', startsOn: '2026-10-05', endsOn: '2026-10-18', target: 5, who: 'joined', lowestWins: false, teams: 'none', teamList: [] }]);
    expect((await screen.findByRole('status')).textContent).toBe('Changes saved. Your members see them now.');
  });

  it('Cancel asks first, in a box that names who has joined; Keep it changes nothing; the press cancels the one it was made on', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week'), challenge('b', 'Joiners', { who: 'joined', joinedCount: 24 })]));
    svc.setCancelled.mockResolvedValue(challenge('b', 'Joiners', { cancelled: true }));
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cardOf('Joiners')).getByRole('button', { name: 'Cancel Joiners' }));
    const box = within(within(cardOf('Joiners')).getByRole('group', { name: 'Cancel Joiners?' }));
    expect(box.getByText('Your members see it marked Cancelled for 7 days, then it leaves their list. Its board stops showing straight away.')).toBeTruthy();
    expect(box.getByText(/^24 people have joined\. The app doesn't tell them yet/)).toBeTruthy();
    expect(box.getByText(/You can un-cancel it until Sun 11 Oct\.$/)).toBeTruthy();
    // The other challenge has no box and still has its own buttons.
    expect(within(cardOf('October Week')).queryByRole('group')).toBeNull();
    fireEvent.click(box.getByRole('button', { name: 'Keep it' }));
    expect(svc.setCancelled).not.toHaveBeenCalled();

    fireEvent.click(within(cardOf('Joiners')).getByRole('button', { name: 'Cancel Joiners' }));
    fireEvent.click(within(cardOf('Joiners')).getByRole('button', { name: 'Cancel challenge' }));
    await waitFor(() => expect(svc.setCancelled).toHaveBeenCalledWith('g1', 'b', true));
    expect(svc.setCancelled).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('status')).textContent).toBe('Challenge cancelled. Your members see it marked Cancelled.');
  });

  it('a cancelled one is marked and can be brought back with one press; it shows no board', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'Called off', { cancelled: true })]));
    svc.setCancelled.mockResolvedValue(challenge('a', 'Called off'));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    const card = within(cardOf('Called off'));
    expect(card.getByText('Cancelled')).toBeTruthy();
    expect(card.queryByRole('button', { name: /board/ })).toBeNull();
    fireEvent.click(card.getByRole('button', { name: 'Un-cancel Called off' }));
    await waitFor(() => expect(svc.setCancelled).toHaveBeenCalledWith('g1', 'a', false));
    expect((await screen.findByRole('status')).textContent).toBe('Challenge un-cancelled. Your members see it as on again.');
  });

  it("its board: everybody's full name, the place members see, why some are hidden, who reached the target and who has nothing yet", async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week', { target: 3, who: 'joined', joinedCount: 6 })]));
    svc.board.mockResolvedValue(
      boardOf(
        [
          row('h', 'Hema Hidden', null, 7, { hidden: 'hide_me', reached: true }),
          row('1', 'Asha Rao', 1, 3, { reached: true }),
          row('2', 'Bilal Khan', 2, 2),
          row('3', 'Chen Wu', 2, 2),
          row('n', null, null, 2, { hidden: 'no_name' }),
          row('z', 'Zed Zero', null, 0),
        ],
        { reached: 2 },
      ),
    );
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(within(cardOf('October Week')).getByRole('button', { name: 'See the board: October Week' }));
    const board = within(await screen.findByTestId('challenge-board'));
    await waitFor(() => expect(svc.board).toHaveBeenCalledWith('g1', 'a', 1));
    expect(board.getByText('Members see 3 people on its board; 2 more are listed here and hidden from them.')).toBeTruthy();
    expect(board.getByText('2 people have reached 3 gym days.')).toBeTruthy();
    expect(board.getAllByTestId('challenge-row').map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      '—Hema HiddenChose Hide meReached7 gym days',
      '1stAsha RaoReached3 gym days',
      '2ndBilal Khan2 gym days',
      '2ndChen Wu2 gym days',
      '—No name yetHidden until they add a name2 gym days',
      '—Zed ZeroNothing counted yet0 gym days',
    ]);
    expect(board.getByText('Updated 12:00 pm')).toBeTruthy();
    fireEvent.click(within(cardOf('October Week')).getByRole('button', { name: 'Hide the board: October Week' }));
    expect(screen.queryByTestId('challenge-board')).toBeNull();
  });

  it("the gym's own count: the form asks what is counted and offers lowest wins, and sends both", async () => {
    svc.add.mockImplementation(async (_gym, _key, fields) => challenge('new', fields.name, { ...fields, state: 'running', joinedCount: null }));
    await openAdd();
    expect(form().queryByLabelText('What your staff count')).toBeNull();
    const wins = () => within(form().getByRole('radiogroup', { name: 'How it is won' })).getAllByRole('radio').map((r) => r.textContent);
    expect(wins()).toHaveLength(2);
    pick('Who counts it', 'Your staff');
    expect(picked('Who counts it')).toBe("Your staffFor anything the app can't count: push-ups, a 5 km time, weight lifted. Your staff enter each person's number.");
    // What the app counts is no longer asked; what the staff count is.
    expect(form().queryByRole('radiogroup', { name: 'What the app counts' })).toBeNull();
    expect(form().getByText("As you would say it after a number: push-ups, kilometres, seconds. From the challenge's first day, open it and press Enter numbers to add each member's number.")).toBeTruthy();
    // Until their word is typed the three ways to win read in general words; then in theirs.
    expect(wins()).toEqual([
      'Highest number winsThe member with the highest number when it ends comes 1st.',
      'Reach a targetYou set the target, such as 100. Everyone who reaches it wins.',
      'Lowest number winsFor a fastest time. The member with the lowest number when it ends comes 1st.',
    ]);
    type('Challenge name', 'Row 500 m');
    pickDate('First day', '2026-10-07');
    pickDate('Last day', '2026-10-14');
    pick('How it is won', 'Lowest number wins');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    expect(form().getByRole('alert').textContent).toBe('Say what your staff count, for example push-ups.');
    type('What your staff count', 'seconds');
    expect(wins()).toEqual([
      'Most seconds winsThe member with the most seconds when it ends comes 1st.',
      'Reach a targetYou set the target, such as 100 seconds. Everyone who reaches it wins.',
      'Fewest seconds winsFor a fastest time. The member with the fewest seconds when it ends comes 1st.',
    ]);
    expect(picked('How it is won')).toContain('Fewest seconds wins');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    expect(svc.add.mock.calls[0][2]).toEqual({ name: 'Row 500 m', details: '', prize: '', unit: 'seconds', counts: 'own', startsOn: '2026-10-07', endsOn: '2026-10-14', target: null, who: 'everyone', lowestWins: true, teams: 'none', teamList: [] });
    // Back on the app's own count, lowest wins is gone and is not sent.
    fireEvent.click(await screen.findByRole('button', { name: 'Add challenge' }));
    pick('Who counts it', 'Your staff');
    pick('How it is won', 'Lowest number wins');
    pick('Who counts it', 'The app');
    expect(picked('What the app counts')).toContain('Gym days');
    expect(picked('How it is won')).toContain('Most gym days wins');
  });

  it("the gym's own count: staff type each person's number on its board, and only the changed ones are saved", async () => {
    const own = challenge('a', 'Push-up Day', { counts: 'own', unit: 'push-ups', target: 50 });
    svc.list.mockResolvedValue(listOf([own]));
    const rows = [row('1', 'Asha Rao', 1, 60, { reached: true }), row('2', 'Bilal Khan', 2, 40), row('3', 'Chen Wu', null, 0), row('h', 'Hema Hidden', null, 0, { hidden: 'hide_me' })];
    svc.board.mockResolvedValue(boardOf(rows, { reached: 1, memberStatus: 'too_few' }));
    svc.setScores.mockResolvedValue(2);
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    // The board is there to read, with no boxes; Enter numbers is its own button.
    fireEvent.click(within(cardOf('Push-up Day')).getByRole('button', { name: 'See the board: Push-up Day' }));
    const reading = within(await screen.findByTestId('challenge-board'));
    await reading.findByText('Asha Rao');
    expect(reading.queryByRole('textbox')).toBeNull();
    fireEvent.click(within(cardOf('Push-up Day')).getByRole('button', { name: 'Enter numbers: Push-up Day' }));
    const board = within(await screen.findByTestId('challenge-board'));
    expect(board.getByText("Type each person's push-ups and press Save numbers. An empty box is no number. Your members see a saved number straight away.")).toBeTruthy();
    const box = (name) => board.getByLabelText(`${name}: number`);
    expect([box('Asha Rao').value, box('Bilal Khan').value, box('Chen Wu').value, box('Hema Hidden').value]).toEqual(['60', '40', '', '']);

    // Nothing changed: nothing is sent, and the page says so.
    fireEvent.click(board.getByRole('button', { name: 'Save numbers' }));
    expect(board.getByRole('status').textContent).toBe('Nothing has changed yet.');
    // Something that is no number stops the whole save.
    fireEvent.change(box('Chen Wu'), { target: { value: 'lots' } });
    fireEvent.click(board.getByRole('button', { name: 'Save numbers' }));
    expect(board.getByRole('alert').textContent).toBe("Chen Wu's box isn't a number. Type a whole number up to 1,000,000, or leave it empty.");
    expect(svc.setScores).not.toHaveBeenCalled();

    fireEvent.change(box('Chen Wu'), { target: { value: '55' } });
    fireEvent.change(box('Bilal Khan'), { target: { value: '' } });
    svc.board.mockResolvedValue(boardOf([rows[0], row('3', 'Chen Wu', 2, 55, { reached: true }), row('2', 'Bilal Khan', null, 0), rows[3]], { reached: 2, memberStatus: 'too_few' }));
    fireEvent.click(board.getByRole('button', { name: 'Save numbers' }));
    await waitFor(() => expect(svc.setScores).toHaveBeenCalledTimes(1));
    expect(svc.setScores.mock.calls[0]).toEqual(['g1', 'a', [{ userId: '2', value: null }, { userId: '3', value: 55 }]]);
    expect((await board.findByRole('status')).textContent).toBe('Saved. 2 numbers changed.');
    expect([box('Chen Wu').value, box('Bilal Khan').value]).toEqual(['55', '']);
  });

  it('numbers typed on page 1 are still saved after staff go to page 2 and save there', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'Push-up Day', { counts: 'own', unit: 'push-ups' })]));
    const hundred = (from) => Array.from({ length: 100 }, (_, i) => row(`u${from + i}`, `Person ${from + i}`, null, 0));
    svc.board.mockImplementation(async (_gym, _id, page) => boardOf(hundred((page - 1) * 100 + 1), { page, pages: 2, total: 200, ranked: 0, memberStatus: 'too_few' }));
    svc.setScores.mockResolvedValue(2);
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(within(cardOf('Push-up Day')).getByRole('button', { name: 'Enter numbers: Push-up Day' }));
    const board = within(await screen.findByTestId('challenge-board'));
    fireEvent.change(await board.findByLabelText('Person 1: number'), { target: { value: '11' } });
    expect(board.getByRole('note').textContent).toMatch(/^1 number is typed and not saved yet\./);
    fireEvent.click(board.getByRole('button', { name: 'Next' }));
    // A box on page 1 that is no number is named from page 2.
    await board.findByLabelText('Person 101: number');
    fireEvent.click(board.getByRole('button', { name: 'Previous' }));
    fireEvent.change(await board.findByLabelText('Person 2: number'), { target: { value: 'lots' } });
    fireEvent.click(board.getByRole('button', { name: 'Next' }));
    fireEvent.change(await board.findByLabelText('Person 101: number'), { target: { value: '22' } });
    fireEvent.click(board.getByRole('button', { name: 'Save numbers' }));
    expect(board.getByRole('alert').textContent).toMatch(/^Person 2's box isn't a number\./);
    expect(svc.setScores).not.toHaveBeenCalled();
    fireEvent.click(board.getByRole('button', { name: 'Previous' }));
    fireEvent.change(await board.findByLabelText('Person 2: number'), { target: { value: '' } });
    fireEvent.click(board.getByRole('button', { name: 'Next' }));
    await board.findByLabelText('Person 101: number');
    fireEvent.click(board.getByRole('button', { name: 'Save numbers' }));
    await waitFor(() => expect(svc.setScores).toHaveBeenCalledTimes(1));
    expect(svc.setScores.mock.calls[0][2]).toEqual([{ userId: 'u1', value: 11 }, { userId: 'u101', value: 22 }]);
    expect((await board.findByRole('status')).textContent).toBe('Saved. 2 numbers changed.');
    expect(board.queryByRole('note')).toBeNull();
    // Back on page 1 the box it typed in is still what it typed until the page is read again.
    fireEvent.click(board.getByRole('button', { name: 'Previous' }));
    await board.findByLabelText('Person 1: number');
  });

  it("the app's own counts and a gym on no plan have no boxes to type in", async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'Gym Week'), challenge('b', 'Push-up Day', { counts: 'own', unit: 'push-ups' })]));
    svc.board.mockResolvedValue(boardOf([row('1', 'Asha Rao', 1, 3)]));
    open({ ...ORG, consoleReadOnly: true });
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(within(cardOf('Push-up Day')).queryByRole('button', { name: 'Enter numbers: Push-up Day' })).toBeNull();
    fireEvent.click(within(cardOf('Push-up Day')).getByRole('button', { name: 'See the board: Push-up Day' }));
    const board = within(await screen.findByTestId('challenge-board'));
    await board.findByText('Asha Rao');
    expect(board.queryByRole('textbox')).toBeNull();
    expect(board.queryByRole('button', { name: 'Save numbers' })).toBeNull();
  });

  it('a long board is read a hundred at a time', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week')]));
    const hundred = (from) => Array.from({ length: 100 }, (_, i) => row(`u${from + i}`, `Person ${from + i}`, from + i, 300 - from - i));
    svc.board.mockImplementation(async (_gym, _id, page) => boardOf(hundred((page - 1) * 100 + 1), { page, pages: 3, total: 240, ranked: 240 }));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(within(cardOf('October Week')).getByRole('button', { name: 'See the board: October Week' }));
    const board = within(await screen.findByTestId('challenge-board'));
    expect(board.getByText('Showing 1–100 of 240')).toBeTruthy();
    expect(board.getByRole('button', { name: 'Previous' }).disabled).toBe(true);
    fireEvent.click(board.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(svc.board).toHaveBeenLastCalledWith('g1', 'a', 2));
    expect(await board.findByText('Showing 101–200 of 240')).toBeTruthy();
  });

  it('past challenges sit behind their own button, with their board and nothing to change', async () => {
    svc.list.mockResolvedValue(listOf([], { past: [challenge('p', 'September', { state: 'ended', startsOn: '2026-09-01', endsOn: '2026-09-30' })], pastTotal: 1 }));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Past challenges (1)' }));
    const card = within(cardOf('September'));
    expect(card.getByText('Ended Wed 30 Sep')).toBeTruthy();
    expect(card.getByRole('button', { name: 'See the board: September' })).toBeTruthy();
    expect(card.queryByRole('button', { name: /Edit|Cancel/ })).toBeNull();
    // Back on the list, the past ones are still open under their button.
    backToList();
    expect(screen.getByText("Challenges that have ended. Your members see each one's result for 14 days. They can't be changed.")).toBeTruthy();
  });

  it('a gym on no plan reads its challenges and is offered nothing that changes them', async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'October Week')]));
    open({ ...ORG, consoleReadOnly: true });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Add challenge' })).toBeNull();
    const card = within(cardOf('October Week'));
    expect(card.queryByRole('button', { name: /Edit|Cancel/ })).toBeNull();
    expect(card.getByRole('button', { name: 'See the board: October Week' })).toBeTruthy();
    expect(screen.getByText(/Your members can't see these challenges until then\.$/)).toBeTruthy();
  });

  it('staff without the tick are told so in the server\'s words, with nothing to press', async () => {
    svc.list.mockRejectedValue(refusal(403, "Your role doesn't allow that."));
    open();
    expect(await screen.findByText("Your role doesn't allow that.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add challenge' })).toBeNull();
  });
});

describe('the page is a list, one challenge, or the form: never all at once', () => {
  const two = () =>
    listOf([
      challenge('a', 'October Week', { prize: 'A shaker', withNumber: 3, top: [{ userId: 'u1', name: 'Priya Sharma', initials: 'PS', place: 1, value: 3 }] }),
      challenge('b', 'Next Week', { state: 'coming', startsOn: '2026-10-12', endsOn: '2026-10-18' }),
    ]);

  it('Open shows one challenge on its own with a way back, and the list is as it was', async () => {
    svc.list.mockResolvedValue(two());
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    // The list holds no board, no Edit and no Cancel: only each challenge's way in.
    expect(screen.queryByRole('button', { name: /^(Edit|Cancel|See the board)/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Open / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Open October Week', 'Open Next Week']);

    fireEvent.click(screen.getByRole('button', { name: 'Open October Week' }));
    const page = within(screen.getByTestId('challenge-detail'));
    expect(page.getByRole('heading', { name: 'October Week' })).toBeTruthy();
    // The other challenge and Add challenge are not on this page.
    expect(cards()).toHaveLength(0);
    expect(screen.queryByText('Next Week')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add challenge' })).toBeNull();
    expect(page.getByRole('button', { name: 'Edit October Week' })).toBeTruthy();
    expect(page.getByRole('button', { name: 'Cancel October Week' })).toBeTruthy();
    expect(within(page.getByRole('region', { name: 'Prize and details' })).getByText('Prize: A shaker')).toBeTruthy();
    expect(within(page.getByRole('region', { name: 'Board' })).getByRole('button', { name: 'See the board: October Week' })).toBeTruthy();

    fireEvent.click(page.getByRole('button', { name: 'All challenges' }));
    expect(screen.queryByTestId('challenge-detail')).toBeNull();
    expect(cards()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add challenge' })).toBeTruthy();
  });

  it('Edit opens the form in place of the challenge, and its back button returns to the challenge with nothing sent', async () => {
    svc.list.mockResolvedValue(two());
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cardOf('Next Week')).getByRole('button', { name: 'Edit Next Week' }));
    expect(screen.queryByTestId('challenge-detail')).toBeNull();
    expect(form().getByRole('heading', { name: 'Edit Next Week' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to all challenges' }));
    expect(screen.queryByTestId('challenge-form')).toBeNull();
    expect(within(screen.getByTestId('challenge-detail')).getByRole('heading', { name: 'Next Week' })).toBeTruthy();
    expect(svc.change).not.toHaveBeenCalled();
  });

  it('the form is three numbered parts, and says the challenge back as it is filled in', async () => {
    await openAdd();
    expect(form().getAllByRole('group', { name: /^Part \d: / }).map((g) => g.getAttribute('aria-label'))).toEqual([
      'Part 1: What it is, and when',
      'Part 2: How it is won, and who is in it',
      'Part 3: Teams, prize and details',
    ]);
    // Each question sits in its own part.
    expect(within(form().getByRole('group', { name: 'Part 1: What it is, and when' })).getByRole('radiogroup', { name: 'Who counts it' })).toBeTruthy();
    expect(within(form().getByRole('group', { name: 'Part 1: What it is, and when' })).getByRole('radiogroup', { name: 'What the app counts' })).toBeTruthy();
    expect(within(form().getByRole('group', { name: 'Part 2: How it is won, and who is in it' })).getByRole('radiogroup', { name: 'Who is in it' })).toBeTruthy();
    expect(within(form().getByRole('group', { name: 'Part 3: Teams, prize and details' })).getByRole('radiogroup', { name: 'Individual or teams' })).toBeTruthy();

    const summary = () => within(screen.getByTestId('challenge-summary')).getAllByRole('definition').map((d) => d.textContent);
    expect(within(screen.getByTestId('challenge-summary')).getAllByRole('term').map((t) => t.textContent)).toEqual(['Name', 'When', 'Counts', 'How it is won', 'Who is in it', 'Teams', 'Prize']);
    expect(summary()).toEqual(['Not named yet', 'Days not picked yet', 'Gym days · counted by the app', 'Most gym days wins', 'Everyone in the app · 143 people', 'Individual, no teams', 'None']);

    type('Challenge name', '  Autumn Twelve ');
    pickDate('First day', '2026-10-12');
    pickDate('Last day', '2026-10-18');
    pick('What the app counts', 'Workout days');
    pick('How it is won', 'Reach a target');
    type('Target, in workout days', '5');
    pick('Who is in it', 'Only people who join');
    pick('Individual or teams', 'Teams: your members pick their own');
    // In teams the target is a whole team's, and the box says so.
    expect(form().getByTestId('target-unit').textContent).toBe('workout days, for a whole team');
    expect(form().getByLabelText('Target, in workout days, for a whole team').value).toBe('5');
    type('Team 1 name', 'Lions');
    type('Prize (optional)', 'A free month');
    expect(summary()).toEqual([
      'Autumn Twelve',
      'Mon 12 Oct – Sun 18 Oct · 7 days',
      'Workout days · counted by the app',
      'Reach 5 workout days as a team',
      'Members who join',
      'Lions · your members pick their own',
      'A free month',
    ]);
    type('Team 1 name', '');
    expect(summary()[5]).toBe('Not named yet · your members pick their own');
  });
});
