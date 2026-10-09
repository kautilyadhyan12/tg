// A CHALLENGE'S RESULT ON ITS POST IN UPDATES, for a member (spec Part 3 §15.6; ROADMAP
// 19d-ii-b). The sentences are written out here from what the post should say; only the
// network is mocked for the drawn part.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { resultOf, resultPost } from './challengesView';

const svc = { list: vi.fn(), react: vi.fn(), add: vi.fn(), removeOwn: vi.fn(), report: vi.fn(), block: vi.fn(), blocked: vi.fn(), unblock: vi.fn(), person: vi.fn() };
vi.mock('../../api/postsApi', () => ({
  postsService: svc,
  postPhotoUrl: ({ gymId, postId, photoId }) => `http://api.test/v1/orgs/${gymId}/posts/${postId}/photos/${photoId}`,
}));
vi.mock('../../pages/console/gymPagePhotos', () => ({ preparePostPhoto: vi.fn() }));
vi.mock('../../api/leaderboardApi', () => ({ leaderboardService: { profile: vi.fn() } }));
vi.mock('../../api/orgsApi', () => ({ errorText: (_err, fallback) => fallback, errorStatus: (err) => err?.response?.status ?? null }));

const Updates = (await import('./Updates')).default;

const TODAY = '2026-10-08';
const me = (over = {}) => ({ value: 0, place: null, hidden: null, toNextPlace: null, nextPlace: null, reached: false, days: [], ...over });
const row = (name, place, value, over = {}) => ({ userId: `u-${name}`, name, initials: name.slice(0, 1), place, value, reached: false, isMe: false, ...over });
const board = (over = {}) => ({ status: 'shown', ranked: 12, top: [], leaders: 1, reached: null, ...over });
const ended = (over = {}) => ({
  id: 'c1',
  name: 'October Six',
  details: '',
  prize: '',
  counts: 'gym_days',
  unit: '',
  lowestWins: false,
  startsOn: '2026-10-01',
  endsOn: '2026-10-06',
  target: null,
  who: 'everyone',
  teams: 'none',
  cancelled: false,
  state: 'ended',
  joined: false,
  can: { join: false, leave: false, pick: false },
  joinedCount: null,
  teamBoard: null,
  board: board(),
  me: null,
  ...over,
});
const TOP = [row('Asha R.', 1, 5), row('Vera V.', 2, 4), row('Bilal K.', 3, 2)];
const team = (name, place, value, over = {}) => ({ id: `t-${name}`, name, people: 3, value, place, reached: false, waiting: 0, isMine: false, ...over });
const result = (challenge, over = {}) => ({ today: TODAY, canOpen: true, challenge, ...over });
const said = (challenge, over = {}) => resultPost(result(challenge, over), 'Iron House');

describe('what a result post says', () => {
  it('a post that announces no challenge, or one that is not an ended challenge, has no result', () => {
    expect(resultPost(null, 'Iron House')).toBeNull();
    expect(resultPost(undefined, 'Iron House')).toBeNull();
    expect(said(ended({ state: 'running' }))).toBeNull();
    expect(said(ended({ cancelled: true }))).toBeNull();
  });

  it('the most wins: the winner, the first three with their numbers, how it was won and its days', () => {
    expect(said(ended({ board: board({ top: TOP }), prize: 'A month free' }))).toEqual({
      challengeId: 'c1',
      headline: 'Winner: Asha R., with 5 gym days.',
      mine: null,
      facts: 'Most gym days wins · Thu 1 Oct – Tue 6 Oct',
      rows: [
        { key: 'u-Asha R.', place: 1, placeText: '1st', name: 'Asha R.', mine: null, sub: null, number: '5 gym days', reached: false, label: '1st: Asha R., 5 gym days' },
        { key: 'u-Vera V.', place: 2, placeText: '2nd', name: 'Vera V.', mine: null, sub: null, number: '4 gym days', reached: false, label: '2nd: Vera V., 4 gym days' },
        { key: 'u-Bilal K.', place: 3, placeText: '3rd', name: 'Bilal K.', mine: null, sub: null, number: '2 gym days', reached: false, label: '3rd: Bilal K., 2 gym days' },
      ],
      rowsLabel: 'Top three',
      prize: 'Prize: A month free',
      canOpen: true,
    });
  });

  it('the reader is "You" in the rows, and is told how they did', () => {
    const mine = said(ended({ board: board({ top: [TOP[0], row('Vera V.', 2, 4, { isMe: true }), TOP[2]] }), me: me({ value: 4, place: 2 }) }));
    expect(mine.rows.map((r) => r.name)).toEqual(['Asha R.', 'You', 'Bilal K.']);
    expect(mine.mine).toBe('You finished 2nd, with 4 gym days.');
    const won = said(ended({ board: board({ top: [row('Vera V.', 1, 5, { isMe: true })] }), me: me({ value: 5, place: 1 }) }));
    expect(won.headline).toBe('You won, with 5 gym days.');
  });

  it.each([
    ['joint winners', { board: board({ top: [row('Asha R.', 1, 5), row('Vera V.', 1, 5), row('Bilal K.', 3, 2)], leaders: 2 }) }, 'Joint winners: Asha R. and Vera V., with 5 gym days each.'],
    ['a number to reach', { target: 4, board: board({ top: TOP, reached: 2 }) }, '2 people reached 4 gym days.'],
    ['a number nobody reached', { target: 6, board: board({ top: TOP, reached: 0 }) }, 'Nobody reached 6 gym days.'],
    ['too few people', { board: board({ status: 'too_few', ranked: 0, leaders: 0 }) }, 'It finished with fewer than 3 people in it, so there are no places.'],
    ['the lowest wins, in the gym’s own word', { counts: 'own', unit: 'seconds', lowestWins: true, board: board({ top: [row('Asha R.', 1, 58)] }) }, 'Winner: Asha R., with 58 seconds.'],
  ])('%s', (_what, over, headline) => {
    expect(said(ended(over)).headline).toBe(headline);
  });

  it('the gym’s own count with numbers still to come says so, on the post and on the Challenges tab, until staff can no longer type them', () => {
    const waiting = ended({ counts: 'own', unit: 'push-ups', board: board({ status: 'too_few', ranked: 0, leaders: 0 }) });
    const coming = "The staff at Iron House are still adding people's numbers. The result shows here once 3 people have one.";
    expect(said(waiting).headline).toBe(coming);
    expect(said(waiting).rows).toEqual([]);
    expect(resultOf(waiting, { today: TODAY, gymName: 'Iron House' }).headline).toBe(coming);
    // Numbers can be typed for 14 days after its last day, the 6th: the 20th is the last.
    expect(said(waiting, { today: '2026-10-20' }).headline).toBe(coming);
    expect(said(waiting, { today: '2026-10-21' }).headline).toBe('It finished with fewer than 3 people in it, so there are no places.');
    // A challenge the app counts has nothing still to come.
    expect(said(ended({ board: board({ status: 'too_few', ranked: 0, leaders: 0 }) })).headline).toBe('It finished with fewer than 3 people in it, so there are no places.');
  });

  it('in teams: the winning team, every team with its people and number, the reader’s own marked', () => {
    const teamBoard = { status: 'shown', rows: [team('Red Team', 2, 9), team('Blue Team', 1, 14, { isMine: true })], mine: null };
    const teams = said(ended({ teams: 'staff', teamBoard, me: me({ value: 3 }) }));
    expect(teams.headline).toBe('Winner: Blue Team, with 14 gym days.');
    expect(teams.mine).toBe('Your team, Blue Team, won. You had 3 gym days.');
    expect(teams.rowsLabel).toBe('Teams');
    expect(teams.rows.map((r) => [r.placeText, r.name, r.mine, r.sub, r.number])).toEqual([
      ['1st', 'Blue Team', 'Your team', '3 people', '14 gym days'],
      ['2nd', 'Red Team', null, '3 people', '9 gym days'],
    ]);
    expect(teams.facts).toBe('The team with the most gym days wins · Thu 1 Oct – Tue 6 Oct');
    // While members see no numbers, no team is listed with one.
    expect(said(ended({ teams: 'staff', teamBoard: { ...teamBoard, status: 'too_few' } })).rows).toEqual([]);
  });

  it('a challenge the Challenges tab no longer lists cannot be opened from the post', () => {
    expect(said(ended({ board: board({ top: TOP }) }), { canOpen: false }).canOpen).toBe(false);
  });
});

describe('the post, drawn', () => {
  const GYM = { id: 'g1', name: 'Iron House' };
  const post = (id, body, over = {}) => ({
    id,
    author: { name: null, initials: '' },
    body,
    photos: [],
    pinned: false,
    createdAt: '2026-10-07T06:30:00.000Z',
    reactions: { like: 0, love: 0, strong: 0, fire: 0 },
    mine: null,
    fromMember: false,
    authorId: null,
    own: false,
    wrote: false,
    reported: false,
    hidden: false,
    challengeResult: null,
    ...over,
  });
  const feed = (posts) => ({ gymId: 'g1', gymName: 'Iron House', status: 'shown', posting: 'off', blockedCount: 0, supportEmail: null, pinned: [], posts, next: null });

  beforeEach(() => {
    for (const fn of Object.values(svc)) fn.mockReset();
  });
  afterEach(() => cleanup());

  it('shows who won under the post from the gym, and See the challenge opens the Challenges tab', async () => {
    const onChallenge = vi.fn();
    svc.list.mockResolvedValue(
      feed([
        post('r', 'October Six has ended.', { challengeResult: result(ended({ board: board({ top: TOP }), prize: 'A month free', me: me({ value: 1, place: 9 }) })) }),
        post('p', 'New racks'),
      ]),
    );
    render(<Updates gym={GYM} onChallenge={onChallenge} />);
    await waitFor(() => expect(screen.getAllByTestId('post')).toHaveLength(2));
    const [first, second] = screen.getAllByTestId('post');
    expect(within(first).getByText('Iron House')).toBeTruthy();
    expect(within(first).getByText('October Six has ended.')).toBeTruthy();
    const box = within(first).getByTestId('challenge-result');
    expect(within(box).getByText('Winner: Asha R., with 5 gym days.')).toBeTruthy();
    expect(within(box).getByText('You finished 9th, with 1 gym day.')).toBeTruthy();
    expect(within(box).getByRole('list', { name: 'Top three' })).toBeTruthy();
    expect(within(box).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['1st: Asha R., 5 gym days', '2nd: Vera V., 4 gym days', '3rd: Bilal K., 2 gym days']);
    expect(within(box).getByText('Most gym days wins · Thu 1 Oct – Tue 6 Oct')).toBeTruthy();
    expect(within(box).getByText('Prize: A month free')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'See the challenge' }));
    expect(onChallenge).toHaveBeenCalledWith('c1');
    // An ordinary post has no result under it.
    expect(within(second).queryByTestId('challenge-result')).toBeNull();
  });

  it('offers no way to a challenge the tab no longer lists, and none where the page gave no tab to open', async () => {
    const gone = post('r', 'October Six has ended.', { challengeResult: result(ended({ board: board({ top: TOP }) }), { canOpen: false }) });
    svc.list.mockResolvedValue(feed([gone]));
    render(<Updates gym={GYM} onChallenge={vi.fn()} />);
    const box = await screen.findByTestId('challenge-result');
    expect(within(box).getByText('Winner: Asha R., with 5 gym days.')).toBeTruthy();
    expect(within(box).queryByRole('button', { name: 'See the challenge' })).toBeNull();
    cleanup();
    svc.list.mockResolvedValue(feed([post('r', 'October Six has ended.', { challengeResult: result(ended({ board: board({ top: TOP }) })) })]));
    render(<Updates gym={GYM} />);
    expect(within(await screen.findByTestId('challenge-result')).queryByRole('button', { name: 'See the challenge' })).toBeNull();
  });
});
