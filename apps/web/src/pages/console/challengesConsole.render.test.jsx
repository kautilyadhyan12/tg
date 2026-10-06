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
const boardOf = (rows, over = {}) => ({ challengeId: 'a', memberStatus: 'shown', ranked: rows.filter((r) => r.place !== null).length, total: rows.length, reached: null, page: 1, pages: 1, rows, asOf: '2026-10-07T06:30:00.000Z', ...over });

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
const cardOf = (name) => cards().find((el) => within(el).queryByRole('heading', { name }) !== null);
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
        challenge('a', 'October Week', { target: 5, prize: 'A shaker', details: 'Any five days.' }),
        challenge('b', 'Next Week', { state: 'coming', startsOn: '2026-10-12', endsOn: '2026-10-18', who: 'joined', joinedCount: 24, counts: 'workout_days' }),
      ]),
    );
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    const a = within(cardOf('October Week'));
    expect(a.getByText('Running · 5 days left')).toBeTruthy();
    expect(a.getByText('Mon 5 Oct – Sun 11 Oct · 7 days')).toBeTruthy();
    expect(within(a.getByTestId('challenge-facts')).getAllByRole('term').map((t) => t.textContent)).toEqual(['Counts', 'How it is won', 'Who is in it']);
    expect(within(a.getByTestId('challenge-facts')).getAllByRole('definition').map((d) => d.textContent)).toEqual(['Gym days', 'Counted by the app', 'Reach 5', 'Everybody who gets there', 'Everyone in the app · 143']);
    expect(a.getByText('Prize: A shaker')).toBeTruthy();
    expect(a.getByText('Any five days.')).toBeTruthy();
    const b = within(cardOf('Next Week'));
    expect(b.getByText('Starts in 5 days')).toBeTruthy();
    expect(within(b.getByTestId('challenge-facts')).getAllByRole('definition').map((d) => d.textContent)).toEqual(['Workout days', 'Counted by the app', 'Most wins', 'First place', 'Members who join · 24']);
    expect(b.getByRole('button', { name: 'See who has joined: Next Week' })).toBeTruthy();
    expect(screen.getByText('Running and coming up (2)')).toBeTruthy();
  });

  it('adds a challenge from the form: every choice says what it means, and what is sent is what was picked', async () => {
    svc.add.mockImplementation(async (_gym, _key, fields) => challenge('new', fields.name, { ...fields, state: 'coming', joinedCount: 0 }));
    await openAdd();
    // It opens on the commonest challenge.
    expect(picked('What it counts')).toContain('Gym days');
    expect(picked('How it is won')).toContain('Whoever has the most');
    expect(picked('Who is in it')).toContain('Everyone in the app');
    expect(form().getByText('Everybody using the app is in it: 143 people. Nobody has to do anything.')).toBeTruthy();
    expect(form().queryByLabelText('Gym days to reach')).toBeNull();

    type('Challenge name', '  Autumn Twelve ');
    pick('What it counts', 'Workout days');
    pickDate('First day', '2026-10-12');
    pickDate('Last day', '2026-11-08');
    pick('How it is won', 'Everyone who reaches a number');
    expect(form().getByText('One workout day a day is the most anybody can get, and this challenge is 28 days long: 28 is the highest number that can be reached.')).toBeTruthy();
    type('Workout days to reach', '12');
    pick('Who is in it', 'Only people who join');
    type('Prize (optional)', 'A free month');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));

    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    const [gymId, key, fields] = svc.add.mock.calls[0];
    expect(gymId).toBe('g1');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(fields).toEqual({ name: 'Autumn Twelve', details: '', prize: 'A free month', unit: '', counts: 'workout_days', startsOn: '2026-10-12', endsOn: '2026-11-08', target: 12, who: 'joined', lowestWins: false });
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
    pick('How it is won', 'Everyone who reaches a number');
    type('Gym days to reach', '8');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    expect(form().getByRole('alert').textContent).toBe('One a day is counted and this challenge is 7 days long, so the most anyone can reach is 7. Type 7 or less, or make it longer.');
    expect(svc.add).not.toHaveBeenCalled();

    type('Gym days to reach', '7');
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
    pick('What it counts', 'Workout days');
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
    for (const group of ['What it counts', 'How it is won', 'Who is in it']) {
      for (const radio of within(form().getByRole('radiogroup', { name: group })).getAllByRole('radio')) expect(radio.disabled).toBe(true);
    }
    expect(form().getByLabelText('Gym days to reach').disabled).toBe(true);
    expect(form().getByRole('button', { name: 'First day' }).disabled).toBe(true);
    expect(form().getByRole('button', { name: 'Last day' }).disabled).toBe(false);

    type('Challenge name', 'October Fortnight');
    type('Prize (optional)', 'A towel');
    pickDate('Last day', '2026-10-18');
    fireEvent.click(form().getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(1));
    expect(svc.change.mock.calls[0]).toEqual(['g1', 'a', { name: 'October Fortnight', details: '', prize: 'A towel', unit: '', counts: 'gym_days', startsOn: '2026-10-05', endsOn: '2026-10-18', target: 5, who: 'joined', lowestWins: false }]);
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
    expect(board.getByText('Members see 3 people on its board; 3 more are listed here and hidden from them.')).toBeTruthy();
    expect(board.getByText('2 people have reached 3.')).toBeTruthy();
    expect(board.getAllByTestId('challenge-row').map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      '—Hema HiddenChose Hide meReached7',
      '1stAsha RaoReached3',
      '2ndBilal Khan2',
      '2ndChen Wu2',
      '—No name yetHidden until they add a name2',
      '—Zed ZeroNothing counted yet0',
    ]);
    expect(board.getByText('Updated 12:00 pm')).toBeTruthy();
    fireEvent.click(within(cardOf('October Week')).getByRole('button', { name: 'Hide the board: October Week' }));
    expect(screen.queryByTestId('challenge-board')).toBeNull();
  });

  it("the gym's own count: the form asks what is counted and offers lowest wins, and sends both", async () => {
    svc.add.mockImplementation(async (_gym, _key, fields) => challenge('new', fields.name, { ...fields, state: 'running', joinedCount: null }));
    await openAdd();
    expect(form().queryByLabelText('What are you counting?')).toBeNull();
    expect(within(form().getByRole('radiogroup', { name: 'How it is won' })).getAllByRole('radio')).toHaveLength(2);
    pick('What it counts', 'Your own count');
    expect(form().getByText(/Your staff type each person's number on the challenge's board/)).toBeTruthy();
    expect(within(form().getByRole('radiogroup', { name: 'How it is won' })).getAllByRole('radio')).toHaveLength(3);
    type('Challenge name', 'Row 500 m');
    pickDate('First day', '2026-10-07');
    pickDate('Last day', '2026-10-14');
    pick('How it is won', 'Whoever has the lowest');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    expect(form().getByRole('alert').textContent).toBe('Say what you are counting, for example push-ups.');
    type('What are you counting?', 'seconds');
    fireEvent.click(form().getByRole('button', { name: 'Add challenge' }));
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    expect(svc.add.mock.calls[0][2]).toEqual({ name: 'Row 500 m', details: '', prize: '', unit: 'seconds', counts: 'own', startsOn: '2026-10-07', endsOn: '2026-10-14', target: null, who: 'everyone', lowestWins: true });
    // Back on the app's own count, lowest wins is gone and is not sent.
    fireEvent.click(await screen.findByRole('button', { name: 'Add challenge' }));
    pick('What it counts', 'Your own count');
    pick('How it is won', 'Whoever has the lowest');
    pick('What it counts', 'Gym days');
    expect(picked('How it is won')).toContain('Whoever has the most');
  });

  it("the gym's own count: staff type each person's number on its board, and only the changed ones are saved", async () => {
    const own = challenge('a', 'Push-up Day', { counts: 'own', unit: 'push-ups', target: 50 });
    svc.list.mockResolvedValue(listOf([own]));
    const rows = [row('1', 'Asha Rao', 1, 60, { reached: true }), row('2', 'Bilal Khan', 2, 40), row('3', 'Chen Wu', null, 0), row('h', 'Hema Hidden', null, 0, { hidden: 'hide_me' })];
    svc.board.mockResolvedValue(boardOf(rows, { reached: 1, memberStatus: 'too_few' }));
    svc.setScores.mockResolvedValue(2);
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(within(cardOf('Push-up Day')).getByRole('button', { name: 'Enter numbers: Push-up Day' }));
    const board = within(await screen.findByTestId('challenge-board'));
    expect(board.getByText("Type each person's push-ups and press Save numbers. An empty box is no number. Your members see the board as soon as you save.")).toBeTruthy();
    const box = (name) => board.getByLabelText(`${name}: number`);
    expect([box('Asha Rao').value, box('Bilal Khan').value, box('Chen Wu').value, box('Hema Hidden').value]).toEqual(['60', '40', '', '']);

    // Nothing changed: nothing is sent, and the page says so.
    fireEvent.click(board.getByRole('button', { name: 'Save numbers' }));
    expect(board.getByRole('status').textContent).toBe('Nothing has changed yet.');
    // Something that is no number stops the whole save.
    fireEvent.change(box('Chen Wu'), { target: { value: 'lots' } });
    fireEvent.click(board.getByRole('button', { name: 'Save numbers' }));
    expect(board.getByRole('alert').textContent).toMatch(/^A number is a whole number up to 1,000,000\./);
    expect(svc.setScores).not.toHaveBeenCalled();

    fireEvent.change(box('Chen Wu'), { target: { value: '55' } });
    fireEvent.change(box('Bilal Khan'), { target: { value: '' } });
    svc.board.mockResolvedValue(boardOf([rows[0], row('3', 'Chen Wu', 2, 55, { reached: true }), row('2', 'Bilal Khan', null, 0), rows[3]], { reached: 2, memberStatus: 'too_few' }));
    fireEvent.click(board.getByRole('button', { name: 'Save numbers' }));
    await waitFor(() => expect(svc.setScores).toHaveBeenCalledTimes(1));
    expect(svc.setScores.mock.calls[0]).toEqual(['g1', 'a', [{ userId: '2', value: null }, { userId: '3', value: 55 }]]);
    expect((await board.findByRole('status')).textContent).toBe('Saved. 2 numbers changed, and your members see the board now.');
    expect([box('Chen Wu').value, box('Bilal Khan').value]).toEqual(['55', '']);
  });

  it("the app's own counts and a gym on no plan have no boxes to type in", async () => {
    svc.list.mockResolvedValue(listOf([challenge('a', 'Gym Week'), challenge('b', 'Push-up Day', { counts: 'own', unit: 'push-ups' })]));
    svc.board.mockResolvedValue(boardOf([row('1', 'Asha Rao', 1, 3)]));
    open({ ...ORG, consoleReadOnly: true });
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cardOf('Push-up Day')).getByRole('button', { name: 'Enter numbers: Push-up Day' }));
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
