// THE GYM'S UPDATES IN THE CONSOLE, drawn (ROADMAP 19b-i; spec Part 3 §15.2). Only the
// network is mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: remove a post staff did not pick, or without the box
// that says it goes for everyone — so the press is checked against the post it was made on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const svc = {
  list: vi.fn(),
  add: vi.fn(),
  setPinned: vi.fn(),
  remove: vi.fn(),
  reactors: vi.fn(),
  reported: vi.fn(),
  keep: vi.fn(),
  setMembersCanPost: vi.fn(),
  stopped: vi.fn(),
  setStopped: vi.fn(),
  person: vi.fn(),
};
const orgApi = { getMine: vi.fn() };
const prepare = vi.fn();
vi.mock('../../api/postsApi', () => ({
  staffPostsService: svc,
  postPhotoUrl: ({ gymId, postId, photoId }) => `http://api.test/v1/orgs/${gymId}/posts/${postId}/photos/${photoId}`,
}));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('./gymPagePhotos', () => ({ preparePostPhoto: prepare }));

const Updates = (await import('./Updates')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'posts.manage'],
  timezone: 'Asia/Kolkata',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const post = (id, body, over = {}) => ({
  id,
  author: { name: 'Maya Okafor', initials: 'MO' },
  body,
  photos: [],
  pinned: false,
  createdAt: '2026-10-07T06:30:00.000Z',
  reactions: { like: 0, love: 0, strong: 0, fire: 0 },
  mine: null,
  fromMember: false,
  own: false,
  wrote: false,
  reported: false,
  authorId: null,
  authorStopped: false,
  ...over,
});
const feed = (over = {}) => ({ gymId: 'g1', gymName: 'Iron House', membersCanPost: false, reportedCount: 0, pinned: [], posts: [], next: null, ...over });
const reportedList = (items = []) => ({ gymId: 'g1', gymName: 'Iron House', items, total: items.length });
const NO_REASONS = { unkind: 0, photo_of_someone: 0, nudity: 0, spam: 0, other: 0 };

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
const cards = () => screen.getAllByTestId('post');
const composer = () => within(screen.getByTestId('composer'));
const postButton = () => composer().getByRole('button', { name: 'Post to your members' });
const type = (text) => fireEvent.change(composer().getByRole('textbox', { name: /Write a post/ }), { target: { value: text } });
const refusal = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });

beforeEach(() => {
  resetConsoleOrgs();
  for (const fn of [...Object.values(svc), prepare]) fn.mockReset();
  svc.list.mockResolvedValue(feed());
  svc.reported.mockResolvedValue(reportedList());
  svc.stopped.mockResolvedValue({ people: [] });
  let made = 0;
  prepare.mockImplementation((file) => {
    if (file.name.endsWith('.pdf')) return Promise.reject(new Error('unreadable'));
    made += 1;
    return Promise.resolve({ key: `new-${made}`, uploadKey: `up-${made}`, base64: `BASE64${made}`, preview: `blob:${file.name}` });
  });
});
afterEach(() => cleanup());

describe('the page', () => {
  it('lists the pinned post first with who posted, its reactions in words, and its photos', async () => {
    svc.list.mockResolvedValue(
      feed({
        pinned: [post('pin', 'Closed on Friday', { pinned: true, reactions: { like: 3, love: 0, strong: 1, fire: 0 } })],
        posts: [post('a', 'New racks', { photos: [{ id: 'ph1', width: 800, height: 600 }] })],
      }),
    );
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(svc.list).toHaveBeenCalledWith('g1');
    const [pinned, plain] = cards();
    expect(within(pinned).getByText('Maya Okafor')).toBeTruthy();
    expect(within(pinned).getByText('Pinned')).toBeTruthy();
    // The reactions as members see them: an icon and a number each, and none for a zero.
    const shown = within(within(pinned).getByTestId('reactions')).getAllByRole('button');
    expect(shown.map((el) => [el.getAttribute('aria-label'), el.textContent])).toEqual([
      ['Like, 3 people. See who', '3'],
      ['Strong, 1 person. See who', '1'],
    ]);
    // Each icon is filled with the console's accent colour, by name.
    expect(shown.every((el) => el.querySelector('svg')?.style.fill === 'var(--accent)')).toBe(true);
    expect(within(pinned).getByRole('button', { name: 'Unpin' })).toBeTruthy();
    expect(within(plain).getByTestId('reactions').textContent).toBe('No reactions yet');
    expect(within(plain).getByRole('button', { name: 'Pin to the top' })).toBeTruthy();
    expect(within(plain).getByRole('img').getAttribute('src')).toBe('http://api.test/v1/orgs/g1/posts/a/photos/ph1');
    expect(screen.getByText('News from Iron House that your members read in their app')).toBeTruthy();
  });

  it('says there are no posts yet, and says a failed read failed', async () => {
    open();
    expect(await screen.findByText('No posts yet. Write your first one above.')).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    svc.list.mockRejectedValue(new Error('down'));
    open();
    await screen.findByTestId('composer');
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy());
    expect(screen.queryByText(/No posts yet/)).toBeNull();
  });

  it('staff without the tick are told so, and get no form', async () => {
    svc.list.mockRejectedValue(refusal(403, "Your role doesn't allow that."));
    open({ ...ORG, staffRole: 'trainer', privileges: ['members.read'] });
    expect(await screen.findByText("Your role doesn't allow that.")).toBeTruthy();
    expect(screen.queryByTestId('composer')).toBeNull();
  });

  it('a gym with no plan: the posts are shown, nothing can be posted, pinned or removed, and the page says why', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('a', 'Written while we were open')] }));
    open({ ...ORG, subscription: null, consoleReadOnly: true });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByText("This gym needs a plan before anything here can be changed. Your members can't see these posts until then.")).toBeTruthy();
    expect(screen.queryByTestId('composer')).toBeNull();
    expect(within(cards()[0]).queryByRole('button', { name: /Pin|Remove/ })).toBeNull();
  });

  it('uses the organisation’s own word for its people', async () => {
    open({ ...ORG, orgType: 'studio' });
    await screen.findByTestId('composer');
    expect(composer().getByRole('button', { name: 'Post to your clients' })).toBeTruthy();
    expect(screen.getByText('Every one of your clients in the app sees it straight away. Nobody is emailed.')).toBeTruthy();
  });
});

describe('who reacted', () => {
  const liked = () => feed({ posts: [post('a', 'New racks', { reactions: { like: 3, love: 0, strong: 0, fire: 1 } })] });

  it('a press on a reaction shows who gave it, by name; a second press or Close folds it away', async () => {
    svc.list.mockResolvedValue(liked());
    // One more person reacted after the page was read: the answer says 4.
    svc.reactors.mockResolvedValue({ reaction: 'like', total: 4, people: [{ name: 'Asha Rao', initials: 'AR' }, { name: null, initials: '' }] });
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    const card = within(cards()[0]);
    expect(svc.reactors).not.toHaveBeenCalled();
    fireEvent.click(card.getByRole('button', { name: 'Like, 3 people. See who' }));
    expect(svc.reactors).toHaveBeenCalledWith('g1', 'a', 'like');
    const box = within(await card.findByRole('region', { name: 'Who reacted Like' }));
    expect((await box.findAllByRole('listitem')).map((li) => li.textContent)).toEqual(['Asha Rao', 'No name yet']);
    // The heading takes the answer's own number, so it and the names always agree; the
    // people the list does not carry are said, never hidden.
    expect(box.getByText('Like · 4 people')).toBeTruthy();
    expect(box.queryByText('Like · 3 people')).toBeNull();
    expect(box.getByText('and 2 more')).toBeTruthy();
    expect(card.getByRole('button', { name: 'Like, 3 people. See who' }).getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(box.getByRole('button', { name: 'Close' }));
    expect(card.queryByRole('region')).toBeNull();
    fireEvent.click(card.getByRole('button', { name: 'Like, 3 people. See who' }));
    fireEvent.click(card.getByRole('button', { name: 'Like, 3 people. See who' }));
    expect(card.queryByRole('region')).toBeNull();
  });

  it('pressing another reaction shows that one, and a slow answer to the first is never drawn under it', async () => {
    svc.list.mockResolvedValue(liked());
    let first;
    svc.reactors
      .mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
      .mockResolvedValueOnce({ reaction: 'fire', total: 1, people: [{ name: 'Chen Wu', initials: 'CW' }] });
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    const card = within(cards()[0]);
    fireEvent.click(card.getByRole('button', { name: 'Like, 3 people. See who' }));
    fireEvent.click(card.getByRole('button', { name: 'Fire, 1 person. See who' }));
    const box = within(await card.findByRole('region', { name: 'Who reacted Fire' }));
    expect(await box.findByText('Chen Wu')).toBeTruthy();
    first({ reaction: 'like', total: 3, people: [{ name: 'Asha Rao', initials: 'AR' }] });
    await Promise.resolve();
    expect(box.queryByText('Asha Rao')).toBeNull();
    expect(box.getByText('Fire · 1 person')).toBeTruthy();
  });

  it('says so when the names cannot be read', async () => {
    svc.list.mockResolvedValue(liked());
    svc.reactors.mockRejectedValue(new Error('down'));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Like, 3 people. See who' }));
    expect((await within(cards()[0]).findByRole('alert')).textContent).toMatch(/Couldn't reach the server/);
  });
});

describe('writing a post', () => {
  it('Post waits for something to post, sends the words under one key, and says who can see it', async () => {
    svc.add.mockResolvedValue({ post: post('new', 'We reopen at six') });
    open();
    await screen.findByTestId('composer');
    expect(postButton().disabled).toBe(true);
    type('   ');
    expect(postButton().disabled).toBe(true);
    type('We reopen at six');
    expect(composer().getByText('1,984 characters left')).toBeTruthy();
    svc.list.mockResolvedValue(feed({ posts: [post('new', 'We reopen at six')] }));
    fireEvent.click(postButton());
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    const [gymId, postKey, body, photos] = svc.add.mock.calls[0];
    expect([gymId, body, photos]).toEqual(['g1', 'We reopen at six', []]);
    expect(postKey).toMatch(/^[0-9a-f-]{36}$/);
    expect((await screen.findByRole('status')).textContent).toBe('Posted. Your members can see it now.');
    await waitFor(() => expect(cards()).toHaveLength(1));
    // The form is empty again, for the next post.
    expect(composer().getByRole('textbox', { name: /Write a post/ }).value).toBe('');
  });

  it('a post that fails keeps its words, says why, and is sent again under the same key', async () => {
    svc.add.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ post: post('new', 'Try me') });
    open();
    await screen.findByTestId('composer');
    type('Try me');
    fireEvent.click(postButton());
    expect((await composer().findByRole('alert')).textContent).toMatch(/Couldn't reach the server/);
    expect(composer().getByRole('textbox', { name: /Write a post/ }).value).toBe('Try me');
    fireEvent.click(postButton());
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(2));
    expect(svc.add.mock.calls[1][1]).toBe(svc.add.mock.calls[0][1]);
    // The next post gets a key of its own.
    await screen.findByRole('status');
    type('Another');
    fireEvent.click(postButton());
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(3));
    expect(svc.add.mock.calls[2][1]).not.toBe(svc.add.mock.calls[0][1]);
  });

  it('too many words: Post is held and the line says how many too many', async () => {
    open();
    await screen.findByTestId('composer');
    type('a'.repeat(2003));
    expect(composer().getByText('3 characters too many')).toBeTruthy();
    expect(postButton().disabled).toBe(true);
  });

  it('adds up to four photos, names the ones it could not add, and sends them in order', async () => {
    svc.add.mockResolvedValue({ post: post('new', '') });
    open();
    await screen.findByTestId('composer');
    const picker = composer().getByLabelText('Choose photos');
    const files = ['one.jpg', 'notes.pdf', 'two.jpg', 'three.jpg', 'four.jpg', 'five.jpg'].map((name) => new File(['x'], name));
    fireEvent.change(picker, { target: { files } });
    await waitFor(() => expect(composer().getAllByRole('img')).toHaveLength(4));
    expect(composer().getByRole('alert').textContent).toBe(
      "We couldn't open “notes.pdf”. Choose a JPEG, PNG or WebP photo. A post holds up to 4 photos, so 1 photo was not added.",
    );
    expect(composer().getByRole('button', { name: 'Add photos' }).disabled).toBe(true);
    // One taken off again: three go, in the order shown.
    fireEvent.click(composer().getByRole('button', { name: 'Take photo 2 off this post' }));
    expect(composer().getAllByRole('img')).toHaveLength(3);
    expect(postButton().disabled).toBe(false);
    fireEvent.click(postButton());
    await waitFor(() => expect(svc.add).toHaveBeenCalledTimes(1));
    expect(svc.add.mock.calls[0][3]).toEqual(['BASE641', 'BASE643', 'BASE644']);
  });
});

describe('pinning and removing', () => {
  const two = () => feed({ posts: [post('a', 'Stay'), post('b', 'Go', { photos: [{ id: 'ph1', width: 1, height: 1 }, { id: 'ph2', width: 1, height: 1 }] })] });

  it('Remove asks first in a box that says it goes for everyone; Keep post removes nothing', async () => {
    svc.list.mockResolvedValue(two());
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Remove post' }));
    expect(svc.remove).not.toHaveBeenCalled();
    const box = within(within(cards()[1]).getByRole('group', { name: 'Remove this post?' }));
    expect(box.getByText("The post and its 2 photos will disappear for every one of your members and for your staff. This can't be undone.")).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Keep post' }));
    expect(svc.remove).not.toHaveBeenCalled();
    expect(within(cards()[1]).queryByRole('group')).toBeNull();
    // The other post has no box open.
    expect(within(cards()[0]).queryByRole('group')).toBeNull();
  });

  it('Remove post removes the post it was pressed on, then shows the list as it now is', async () => {
    svc.list.mockResolvedValueOnce(two()).mockResolvedValue(feed({ posts: [post('a', 'Stay')] }));
    svc.remove.mockResolvedValue({ removed: true });
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Remove post' }));
    fireEvent.click(within(cards()[1]).getByRole('group').querySelector('.c-btn-danger'));
    await waitFor(() => expect(svc.remove).toHaveBeenCalledTimes(1));
    expect(svc.remove).toHaveBeenCalledWith('g1', 'b');
    expect((await screen.findByRole('status')).textContent).toBe('Post removed. Your members no longer see it.');
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain('Stay');
  });

  it('removing or pinning after "Show older posts" keeps the older posts where they were, and asks for no new list', async () => {
    svc.list
      .mockResolvedValueOnce(feed({ posts: [post('a', 'Newest', { createdAt: '2026-10-07T09:00:00.000Z' }), post('b', 'Middle', { createdAt: '2026-10-07T08:00:00.000Z' })], next: 'cursor-1' }))
      .mockResolvedValueOnce(feed({ posts: [post('c', 'Older', { createdAt: '2026-10-07T07:00:00.000Z' }), post('d', 'Oldest', { createdAt: '2026-10-07T06:00:00.000Z' })] }));
    svc.remove.mockResolvedValue({ removed: true });
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await waitFor(() => expect(cards()).toHaveLength(4));
    const words = () => cards().map((card) => ['Newest', 'Middle', 'Older', 'Oldest'].find((w) => card.textContent.includes(w)));

    fireEvent.click(within(cards()[2]).getByRole('button', { name: 'Remove post' }));
    fireEvent.click(within(cards()[2]).getByRole('group').querySelector('.c-btn-danger'));
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(svc.remove).toHaveBeenCalledWith('g1', 'c');
    expect(words()).toEqual(['Newest', 'Middle', 'Oldest']);

    svc.setPinned.mockResolvedValueOnce({ post: post('d', 'Oldest', { pinned: true, createdAt: '2026-10-07T06:00:00.000Z' }) });
    fireEvent.click(within(cards()[2]).getByRole('button', { name: 'Pin to the top' }));
    await waitFor(() => expect(words()).toEqual(['Oldest', 'Newest', 'Middle']));
    svc.setPinned.mockResolvedValueOnce({ post: post('d', 'Oldest', { pinned: false, createdAt: '2026-10-07T06:00:00.000Z' }) });
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Unpin' }));
    await waitFor(() => expect(words()).toEqual(['Newest', 'Middle', 'Oldest']));
    expect(svc.list).toHaveBeenCalledTimes(2);
  });

  it('a removal that fails says so and keeps the post', async () => {
    svc.list.mockResolvedValue(two());
    svc.remove.mockRejectedValue(new Error('down'));
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Remove post' }));
    fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Remove post' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't reach the server/);
    expect(cards()).toHaveLength(2);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pins and unpins the post pressed', async () => {
    svc.list.mockResolvedValueOnce(two()).mockResolvedValue(feed({ pinned: [post('b', 'Go', { pinned: true })], posts: [post('a', 'Stay')] }));
    svc.setPinned.mockResolvedValue({ post: post('b', 'Go', { pinned: true }) });
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Pin to the top' }));
    await waitFor(() => expect(svc.setPinned).toHaveBeenCalledWith('g1', 'b', true));
    expect((await screen.findByRole('status')).textContent).toBe('Pinned to the top.');
    expect(cards()[0].textContent).toContain('Go');
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Unpin' }));
    await waitFor(() => expect(svc.setPinned).toHaveBeenLastCalledWith('g1', 'b', false));
  });

  it('with three pinned, Pin is held on the others and says why', async () => {
    svc.list.mockResolvedValue(
      feed({ pinned: ['p1', 'p2', 'p3'].map((id) => post(id, id, { pinned: true })), posts: [post('a', 'One more')] }),
    );
    open();
    await waitFor(() => expect(cards()).toHaveLength(4));
    const last = within(cards()[3]);
    expect(last.getByRole('button', { name: 'Pin to the top' }).disabled).toBe(true);
    expect(last.getByText('You can pin up to 3 posts. Unpin one to pin this.')).toBeTruthy();
    expect(within(cards()[0]).getByRole('button', { name: 'Unpin' }).disabled).toBe(false);
  });

  it('a pin the server refuses is said in its own words, and the list is read again', async () => {
    svc.list.mockResolvedValue(two());
    svc.setPinned.mockRejectedValue(refusal(409, 'You can pin up to 3 posts. Unpin one to pin this.'));
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Pin to the top' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You can pin up to 3 posts. Unpin one to pin this.');
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });
});

describe('members’ posts', () => {
  const memberPost = (id, body, over = {}) => post(id, body, { fromMember: true, authorId: 'u-wendy', author: { name: 'Wendy Writer', initials: 'WW' }, ...over });
  const theSwitch = () => within(screen.getByTestId('members-can-post')).getByRole('switch', { name: 'Members can post' });

  it('the switch is off to start, says what it does, and a press switches it for this gym', async () => {
    svc.setMembersCanPost.mockResolvedValue({ membersCanPost: true });
    open();
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByText('Only your staff can post. Switch this on to let your members post too.')).toBeTruthy();
    fireEvent.click(theSwitch());
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
    expect(svc.setMembersCanPost.mock.calls).toEqual([['g1', true]]);
    expect(screen.getByRole('status').textContent).toBe('Your members can post now.');
    expect(screen.getByText('Your members can post words and photos here. You can remove any post, and stop a person posting.')).toBeTruthy();
  });

  it('switching it off says members’ posts stay, and a switch that fails stays where it was', async () => {
    svc.list.mockResolvedValue(feed({ membersCanPost: true }));
    svc.setMembersCanPost.mockResolvedValueOnce({ membersCanPost: false }).mockRejectedValueOnce(refusal(409, 'Your plan has ended.'));
    open();
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(theSwitch());
    expect((await screen.findByRole('status')).textContent).toBe('Members can no longer post. The posts they already made stay until you remove them.');
    fireEvent.click(theSwitch());
    expect((await screen.findByRole('alert')).textContent).toBe('Your plan has ended.');
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('a gym with no plan cannot move the switch', async () => {
    svc.list.mockResolvedValue(feed({ membersCanPost: true }));
    open({ ...ORG, subscription: null, consoleReadOnly: true });
    await waitFor(() => expect(theSwitch().disabled).toBe(true));
  });

  it('a member’s post is marked, and only it offers "Stop them posting"', async () => {
    svc.list.mockResolvedValue(feed({ posts: [memberPost('m', 'From a member'), post('s', 'From the gym')] }));
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(within(cards()[0]).getByText('Member')).toBeTruthy();
    expect(within(cards()[0]).getByRole('button', { name: 'Stop them posting' })).toBeTruthy();
    expect(within(cards()[1]).queryByText('Member')).toBeNull();
    expect(within(cards()[1]).queryByRole('button', { name: 'Stop them posting' })).toBeNull();
  });

  it('stopping a person asks first in a box that names them, stops the writer of the post pressed, and marks their posts', async () => {
    svc.list.mockResolvedValue(
      feed({ posts: [memberPost('a', 'Wendy one'), memberPost('b', 'Omar one', { authorId: 'u-omar', author: { name: 'Omar Other', initials: 'OO' } }), memberPost('c', 'Wendy two')] }),
    );
    svc.setStopped.mockResolvedValue({ stopped: true });
    open();
    await waitFor(() => expect(cards()).toHaveLength(3));
    fireEvent.click(within(cards()[2]).getByRole('button', { name: 'Stop them posting' }));
    const box = within(within(cards()[2]).getByRole('group', { name: 'Stop Wendy Writer posting?' }));
    expect(
      box.getByText(
        "Wendy Writer won't be able to post on Updates until you let them again. They can still read and react. Their posts stay until you remove them. They aren't emailed, and nobody else changes.",
      ),
    ).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Cancel' }));
    expect(svc.setStopped).not.toHaveBeenCalled();

    fireEvent.click(within(cards()[2]).getByRole('button', { name: 'Stop them posting' }));
    fireEvent.click(within(cards()[2]).getByRole('button', { name: 'Stop Wendy Writer posting' }));
    await waitFor(() => expect(svc.setStopped.mock.calls).toEqual([['g1', 'u-wendy', true]]));
    expect((await screen.findByRole('status')).textContent).toBe('Wendy Writer can no longer post.');
    // Both of Wendy's posts say so and offer the way back; Omar's is untouched.
    await waitFor(() => expect(within(cards()[0]).getByText('Stopped from posting')).toBeTruthy());
    expect(within(cards()[2]).getByRole('button', { name: 'Let them post again' })).toBeTruthy();
    expect(within(cards()[1]).queryByText('Stopped from posting')).toBeNull();
    expect(within(cards()[1]).getByRole('button', { name: 'Stop them posting' })).toBeTruthy();
    expect(cards()).toHaveLength(3);
  });

  it('the people stopped are listed by name, and "Let them post again" lets that one back', async () => {
    svc.list.mockResolvedValue(feed({ posts: [memberPost('a', 'Wendy one', { authorStopped: true })] }));
    svc.stopped.mockResolvedValueOnce({
      people: [
        { userId: 'u-wendy', name: 'Wendy Writer', initials: 'WW', stoppedAt: '2026-10-07T06:30:00.000Z' },
        { userId: 'u-nameless', name: null, initials: '', stoppedAt: '2026-10-06T06:30:00.000Z' },
      ],
    });
    svc.setStopped.mockResolvedValue({ stopped: false });
    open();
    const list = within(await screen.findByTestId('stopped'));
    expect(list.getByText('Wendy Writer')).toBeTruthy();
    expect(list.getByText('No name yet')).toBeTruthy();
    fireEvent.click(list.getAllByRole('button', { name: 'Let them post again' })[0]);
    await waitFor(() => expect(svc.setStopped.mock.calls).toEqual([['g1', 'u-wendy', false]]));
    expect((await screen.findByRole('status')).textContent).toBe('Wendy Writer can post again.');
    await waitFor(() => expect(screen.queryByTestId('stopped')).toBeNull());
    expect(within(cards()[0]).queryByText('Stopped from posting')).toBeNull();
  });
});

describe('reported posts', () => {
  const wendy = { fromMember: true, authorId: 'u-wendy', author: { name: 'Wendy Writer', initials: 'WW' } };
  // Four reports of each post were answered before: `allReports` is never `reports` here.
  const item = (id, body, reasons, over = {}) => ({
    post: post(id, body, { ...wendy, ...over }),
    reports: Object.values(reasons).reduce((a, b) => a + b, 0),
    allReports: Object.values(reasons).reduce((a, b) => a + b, 0) + 4,
    reasons: { ...NO_REASONS, ...reasons },
    notes: [],
    firstReportedAt: '2026-10-07T07:00:00.000Z',
    lastReportedAt: `2026-10-07T08:00:0${id === 'r1' ? 1 : 2}.000Z`,
  });
  const reportedCards = () => screen.getAllByTestId('reported-post');
  const two = () => reportedList([item('r1', 'Look at the state of him', { unkind: 2, photo_of_someone: 1 }), item('r2', 'Shakes for sale', { spam: 1 })]);

  it('nothing is drawn while no post is reported', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('a', 'Fine')] }));
    open();
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.queryByTestId('reported')).toBeNull();
  });

  it('lists each reported post with how many reported it and why, and never who', async () => {
    svc.reported.mockResolvedValue(two());
    open();
    await waitFor(() => expect(reportedCards()).toHaveLength(2));
    const section = within(screen.getByTestId('reported'));
    expect(section.getByRole('heading', { name: '2 reported posts to look at' })).toBeTruthy();
    expect(within(reportedCards()[0]).getByText("Reported by 3 people: Bullying or unkind (2) · A photo of someone who didn't agree to it (1)")).toBeTruthy();
    expect(within(reportedCards()[1]).getByText('Reported by 1 person: Spam or selling')).toBeTruthy();
    expect(within(reportedCards()[0]).getByText('Look at the state of him')).toBeTruthy();
    // The writer's name, then Keep, Remove and Stop; a reported post is not pinned from here.
    expect(within(reportedCards()[0]).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim())).toEqual(['See what Wendy Writer has posted', 'Keep post', 'Remove post', 'Stop them posting']);
  });

  it('shows what reporters typed, under the post it was typed about, and nothing where nobody typed', async () => {
    const list = two();
    list.items[0].notes = ['He says this to her every week', 'Second line\nof a note'];
    svc.reported.mockResolvedValue(list);
    open();
    await waitFor(() => expect(reportedCards()).toHaveLength(2));
    const notes = within(within(reportedCards()[0]).getByTestId('report-notes'));
    expect(notes.getByText('What people who reported it wrote:')).toBeTruthy();
    expect(notes.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['“He says this to her every week”', '“Second line\nof a note”']);
    expect(within(reportedCards()[1]).queryByTestId('report-notes')).toBeNull();
  });

  it('Remove asks first, removes the post it was pressed on in one request, and the list is read again', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('r1', 'Look at the state of him', wendy), post('r2', 'Shakes for sale', wendy)] }));
    svc.reported.mockResolvedValueOnce(two()).mockResolvedValue(reportedList([two().items[1]]));
    svc.remove.mockResolvedValue({ removed: true });
    open();
    await waitFor(() => expect(reportedCards()).toHaveLength(2));
    fireEvent.click(within(reportedCards()[0]).getByRole('button', { name: 'Remove post' }));
    const box = within(within(reportedCards()[0]).getByRole('group', { name: 'Remove this post?' }));
    expect(box.getByText("The post will disappear for every one of your members and for your staff. This can't be undone.")).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Remove post' }));
    await waitFor(() => expect(reportedCards()).toHaveLength(1));
    expect(svc.remove.mock.calls).toEqual([['g1', 'r1']]);
    expect(svc.keep).not.toHaveBeenCalled();
    // Gone from the posts below as well.
    expect(cards().map((c) => c.textContent.includes('Look at the state of him'))).toEqual([false]);
    expect(screen.getByRole('status').textContent).toBe('Post removed. Your members no longer see it.');
  });

  it('Keep keeps the post it was pressed on: it leaves this list and stays among the posts', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('r2', 'Shakes for sale', wendy)] }));
    svc.reported.mockResolvedValueOnce(two()).mockResolvedValue(reportedList([two().items[0]]));
    svc.keep.mockResolvedValue({ kept: true, waiting: 0 });
    open();
    await waitFor(() => expect(reportedCards()).toHaveLength(2));
    fireEvent.click(within(reportedCards()[1]).getByRole('button', { name: 'Keep post' }));
    await waitFor(() => expect(reportedCards()).toHaveLength(1));
    // With how many reports THAT post had had when this list was read, so one that
    // arrives later is not answered.
    expect(svc.keep.mock.calls).toEqual([['g1', 'r2', 5]]);
    expect(svc.remove).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Kept. The post stays on Updates and has left this list.');
  });

  it('a report that arrived while staff were looking: Keep says so, and the post is still listed with it', async () => {
    const later = two();
    later.items[0] = { ...later.items[0], reports: 4, allReports: 8, reasons: { ...NO_REASONS, unkind: 2, photo_of_someone: 2 }, notes: ['That is my brother in the photo'], lastReportedAt: '2026-10-07T09:00:00.000Z' };
    svc.reported.mockResolvedValueOnce(two()).mockResolvedValue(later);
    svc.keep.mockResolvedValue({ kept: false, waiting: 1 });
    open();
    await waitFor(() => expect(reportedCards()).toHaveLength(2));
    fireEvent.click(within(reportedCards()[0]).getByRole('button', { name: 'Keep post' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      '1 more person reported this post while you were looking, so it is still on this list. Read what is new, then choose again.',
    );
    expect(svc.keep.mock.calls).toEqual([['g1', 'r1', 7]]);
    // Read again: the new report and its words are on the screen, and Keep now names it.
    await waitFor(() => expect(within(reportedCards()[0]).getByText('“That is my brother in the photo”')).toBeTruthy());
    expect(reportedCards()).toHaveLength(2);
    fireEvent.click(within(reportedCards()[0]).getByRole('button', { name: 'Keep post' }));
    await waitFor(() => expect(svc.keep).toHaveBeenLastCalledWith('g1', 'r1', 8));
  });

  it('a gym with no plan reads the reported posts and can answer none', async () => {
    svc.reported.mockResolvedValue(two());
    open({ ...ORG, subscription: null, consoleReadOnly: true });
    await waitFor(() => expect(reportedCards()).toHaveLength(2));
    // Only the writer's name, which opens their posts to read: nothing that changes anything.
    expect(within(reportedCards()[0]).queryAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['See what Wendy Writer has posted']);
  });
});

describe('a person’s posts, opened from a name', () => {
  const theirs = (id, body, over = {}) => post(id, body, { fromMember: true, authorId: 'u-wendy', author: { name: 'Wendy Writer', initials: 'WW' }, ...over });
  const openWendy = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'See what Wendy Writer has posted' }));
    return within(await screen.findByTestId('person-posts-box'));
  };

  it('a member’s name opens their posts in a box; a staff post’s name opens nothing', async () => {
    svc.list.mockResolvedValue(feed({ posts: [theirs('a', 'First 5k done'), post('b', 'Closed on Monday')] }));
    svc.person.mockResolvedValue({ posts: [theirs('a', 'First 5k done'), theirs('c', 'Leg day')], next: null, total: 2 });
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(within(cards()[1]).queryByRole('button', { name: /has posted/ })).toBeNull();
    const box = await openWendy();
    await waitFor(() => expect(box.getAllByTestId('post')).toHaveLength(2));
    expect(svc.person).toHaveBeenCalledWith('g1', 'u-wendy');
    // The picture and the name are one thing to press.
    expect(screen.getByRole('button', { name: 'See what Wendy Writer has posted' }).textContent).toContain('WW');
    expect(screen.getByRole('dialog', { name: "Wendy Writer's posts" })).toBeTruthy();
    expect(box.getAllByRole('heading').map((h) => h.textContent)).toEqual(["Wendy Writer's posts"]);
    // A person's own list: Remove and Stop, never Pin, and no name to press again.
    expect(within(box.getAllByTestId('post')[0]).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Remove post', 'Stop them posting']);
    fireEvent.click(box.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByTestId('person-posts-box')).toBeNull());
  });

  it('Remove in the box asks first, removes the post it was pressed on, and the page behind is read again', async () => {
    svc.list.mockResolvedValue(feed({ posts: [theirs('a', 'First 5k done')] }));
    svc.person.mockResolvedValue({ posts: [theirs('a', 'First 5k done'), theirs('c', 'Leg day')], next: null, total: 2 });
    svc.remove.mockResolvedValue({ removed: true });
    open();
    const box = await openWendy();
    await waitFor(() => expect(box.getAllByTestId('post')).toHaveLength(2));
    const second = box.getAllByTestId('post')[1];
    fireEvent.click(within(second).getByRole('button', { name: 'Remove post' }));
    expect(svc.remove).not.toHaveBeenCalled();
    fireEvent.click(within(second).getByRole('button', { name: 'Remove post' }));
    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith('g1', 'c'));
    await waitFor(() => expect(box.getAllByTestId('post')).toHaveLength(1));
    expect(box.getByText('Post removed. Your members no longer see it.')).toBeTruthy();
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it('Stop them posting in the box asks first, stops THAT person, and every post of theirs says so', async () => {
    svc.list.mockResolvedValue(feed({ posts: [theirs('a', 'First 5k done')] }));
    svc.person.mockResolvedValue({ posts: [theirs('a', 'First 5k done'), theirs('c', 'Leg day')], next: null, total: 2 });
    svc.setStopped.mockResolvedValue({ stopped: true });
    open();
    const box = await openWendy();
    await waitFor(() => expect(box.getAllByTestId('post')).toHaveLength(2));
    fireEvent.click(within(box.getAllByTestId('post')[1]).getByRole('button', { name: 'Stop them posting' }));
    expect(svc.setStopped).not.toHaveBeenCalled();
    fireEvent.click(within(box.getAllByTestId('post')[1]).getByRole('button', { name: 'Stop Wendy Writer posting' }));
    await waitFor(() => expect(svc.setStopped).toHaveBeenCalledWith('g1', 'u-wendy', true));
    await waitFor(() => expect(box.getAllByText('Stopped from posting')).toHaveLength(2));
    expect(box.getByText('Wendy Writer can no longer post.')).toBeTruthy();
  });

  it('says so when they have posted nothing, and when the posts cannot be read', async () => {
    svc.list.mockResolvedValue(feed({ posts: [theirs('a', 'First 5k done')] }));
    svc.person.mockResolvedValueOnce({ posts: [], next: null, total: 0 });
    open();
    const box = await openWendy();
    expect(await box.findByText("Wendy Writer hasn't posted anything.")).toBeTruthy();
    fireEvent.click(box.getAllByRole('button', { name: 'Close' })[0]);
    svc.person.mockRejectedValueOnce(refusal(500, 'The posts are not answering.'));
    const again = await openWendy();
    expect((await again.findByRole('alert')).textContent).toBe('The posts are not answering.');
    expect(again.queryByText("Wendy Writer hasn't posted anything.")).toBeNull();
  });

  it('a gym with no plan reads a person’s posts and changes none', async () => {
    svc.list.mockResolvedValue(feed({ posts: [theirs('a', 'First 5k done')] }));
    svc.person.mockResolvedValue({ posts: [theirs('a', 'First 5k done')], next: null, total: 1 });
    open({ ...ORG, subscription: null, consoleReadOnly: true });
    const box = await openWendy();
    await waitFor(() => expect(box.getAllByTestId('post')).toHaveLength(1));
    expect(within(box.getAllByTestId('post')[0]).queryAllByRole('button')).toEqual([]);
  });
});
