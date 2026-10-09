// A CHALLENGE'S RESULT POST ON THE CONSOLE (spec Part 3 §15.6; ROADMAP 19d-ii-b): what the
// challenge's own page says about it, and the post as staff read it on Updates. Only the
// network is mocked for the drawn part.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resultPostNote } from './challengesView';

const svc = { list: vi.fn(), add: vi.fn(), setPinned: vi.fn(), remove: vi.fn(), reactors: vi.fn(), reported: vi.fn(), keep: vi.fn(), setMembersCanPost: vi.fn(), stopped: vi.fn(), setStopped: vi.fn(), person: vi.fn() };
const orgApi = { getMine: vi.fn() };
vi.mock('../../api/postsApi', () => ({
  staffPostsService: svc,
  postPhotoUrl: ({ gymId, postId, photoId }) => `http://api.test/v1/orgs/${gymId}/posts/${postId}/photos/${photoId}`,
}));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('./gymPagePhotos', () => ({ preparePostPhoto: vi.fn() }));

const Updates = (await import('./Updates')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const WORDS = { people: 'members' };

describe('what a challenge’s own page says about its result post', () => {
  const challenge = (over = {}) => ({ state: 'running', cancelled: false, resultPost: null, ...over });
  const posted = { postedAt: '2026-10-07T18:38:00.000Z', removed: false, hidden: false };

  it.each([
    ['running', challenge(), true, { text: 'When it ends, its result is posted to Updates for your members.', link: false, who: null }],
    ['coming', challenge({ state: 'coming' }), true, { text: 'When it ends, its result is posted to Updates for your members.', link: false, who: null }],
    ['cancelled', challenge({ cancelled: true }), true, null],
    ['ended and cancelled, with a post from before', challenge({ state: 'ended', cancelled: true, resultPost: posted }), true, null],
    ['ended, not posted yet', challenge({ state: 'ended' }), true, null],
    ['ended and posted, for staff who post updates', challenge({ state: 'ended', resultPost: posted }), true, { text: 'Its result is posted in Updates.', link: true, who: null }],
    ['ended and posted, for staff who do not', challenge({ state: 'ended', resultPost: posted }), false, { text: 'Its result is posted in Updates.', link: false, who: 'The owner and staff who post updates can open it there.' }],
    ['ended, its post hidden while five reports wait', challenge({ state: 'ended', resultPost: { ...posted, hidden: true } }), true, { text: 'Its result post is hidden from your members while it waits in Reported posts on Updates.', link: true, who: null }],
    ['ended, its post removed', challenge({ state: 'ended', resultPost: { ...posted, removed: true } }), true, { text: "Its result post was removed from Updates, so your members don't see it there now.", link: false, who: null }],
  ])('%s', (_what, given, mayPost, note) => {
    expect(resultPostNote(given, mayPost, WORDS)).toEqual(note);
  });

  it('on no plan nothing is posted, so a running challenge promises nothing; an ended one still says what is true', () => {
    expect(resultPostNote(challenge(), true, WORDS, true)).toBeNull();
    expect(resultPostNote(challenge({ state: 'coming' }), true, WORDS, true)).toBeNull();
    expect(resultPostNote(challenge({ state: 'ended', resultPost: posted }), true, WORDS, true)?.text).toBe('Its result is posted in Updates.');
  });

  it('a challenge read before the server sent the field says nothing false', () => {
    expect(resultPostNote({ state: 'ended', cancelled: false }, true, WORDS)).toBeNull();
  });
});

describe('the result post on the console’s Updates', () => {
  const ORG = {
    id: 'g1',
    slug: 'iron-house',
    name: 'Iron House',
    staffRole: 'manager',
    privileges: ['members.read', 'posts.manage', 'leaderboard.manage'],
    timezone: 'Asia/Kolkata',
    orgType: 'gym',
    subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
  };
  const row = (name, place, value) => ({ userId: `u-${name}`, name, initials: name.slice(0, 1), place, value, reached: false, isMe: false });
  const ended = {
    id: 'c1',
    name: 'October Six',
    details: '',
    prize: 'A month free',
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
    board: { status: 'shown', ranked: 12, top: [row('Asha R.', 1, 5), row('Vera V.', 2, 4), row('Bilal K.', 3, 2)], leaders: 1, reached: null },
    me: null,
  };
  const post = (over = {}) => ({
    id: 'r',
    author: { name: null, initials: '' },
    body: 'October Six has ended.',
    photos: [],
    pinned: false,
    createdAt: '2026-10-07T06:30:00.000Z',
    reactions: { like: 0, love: 0, strong: 0, fire: 0 },
    mine: null,
    fromMember: false,
    own: false,
    wrote: false,
    reported: false,
    hidden: false,
    authorId: null,
    authorStopped: false,
    challengeResult: { today: '2026-10-08', canOpen: true, challenge: ended },
    ...over,
  });
  const feed = (posts) => ({ gymId: 'g1', gymName: 'Iron House', membersCanPost: false, reportedCount: 0, pinned: [], posts, next: null });
  const open = (org = ORG) => {
    orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
    render(
      <MemoryRouter initialEntries={['/console/iron-house/updates']}>
        <Routes>
          <Route path="/console/:orgSlug/updates" element={<Updates />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  beforeEach(() => {
    resetConsoleOrgs();
    for (const fn of [...Object.values(svc), orgApi.getMine]) fn.mockReset();
    svc.reported.mockResolvedValue({ gymId: 'g1', gymName: 'Iron House', items: [], total: 0 });
    svc.stopped.mockResolvedValue({ people: [] });
  });
  afterEach(() => cleanup());

  it('shows the result as members see it, says so, and opens the challenge for staff who run challenges', async () => {
    svc.list.mockResolvedValue(feed([post()]));
    open();
    const box = await screen.findByTestId('challenge-result');
    expect(within(box).getByText('Winner: Asha R., with 5 gym days.')).toBeTruthy();
    expect(within(box).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['1st: Asha R., 5 gym days', '2nd: Vera V., 4 gym days', '3rd: Bilal K., 2 gym days']);
    expect(within(box).getByText('Prize: A month free')).toBeTruthy();
    expect(within(box).getByText('This is what your members see. It changes by itself if a number changes, or if someone is hidden from boards or leaves.')).toBeTruthy();
    expect(within(box).getByRole('link', { name: 'Open the challenge' }).getAttribute('href')).toBe('/console/iron-house/challenges?challenge=c1');
    // From the gym: its name, and no worker's.
    expect(within(screen.getByTestId('post')).getByText('Iron House')).toBeTruthy();
  });

  it('for staff who post updates but do not run challenges, a line says who can open it', async () => {
    svc.list.mockResolvedValue(feed([post()]));
    open({ ...ORG, privileges: ['members.read', 'posts.manage'] });
    const box = await screen.findByTestId('challenge-result');
    expect(within(box).queryByRole('link', { name: 'Open the challenge' })).toBeNull();
    expect(within(box).getByText('The owner and staff who run the leaderboard can open the challenge.')).toBeTruthy();
  });

  it('Remove says the result is not posted again, before anything is removed', async () => {
    svc.list.mockResolvedValue(feed([post(), post({ id: 'p', body: 'New racks', challengeResult: null })]));
    open();
    await waitFor(() => expect(screen.getAllByTestId('post')).toHaveLength(2));
    const [result, plain] = screen.getAllByTestId('post');
    fireEvent.click(within(result).getByRole('button', { name: 'Remove post' }));
    expect(within(result).getByText("The post will disappear for every one of your members and for your staff. This can't be undone. The challenge's result isn't posted again.")).toBeTruthy();
    fireEvent.click(within(plain).getByRole('button', { name: 'Remove post' }));
    expect(within(plain).getByText("The post will disappear for every one of your members and for your staff. This can't be undone.")).toBeTruthy();
    expect(svc.remove).not.toHaveBeenCalled();
  });
});
