// THE GYM'S UPDATES IN THE CONSOLE, drawn (ROADMAP 19b-i; spec Part 3 §15.2). Only the
// network is mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: remove a post staff did not pick, or without the box
// that says it goes for everyone — so the press is checked against the post it was made on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const svc = { list: vi.fn(), add: vi.fn(), setPinned: vi.fn(), remove: vi.fn() };
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
vi.mock('./gymPagePhotos', () => ({ preparePagePhoto: prepare }));

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
  ...over,
});
const feed = (over = {}) => ({ gymId: 'g1', gymName: 'Iron House', live: true, pinned: [], posts: [], next: null, ...over });

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
    expect(within(pinned).getByTestId('reactions').textContent).toBe('Like 3 · Strong 1');
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
    svc.list.mockResolvedValue(feed({ live: false, posts: [post('a', 'Written while we were open')] }));
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
    expect(screen.getByText('Every one of your clients in the app sees it straight away, under your name. Nobody is emailed.')).toBeTruthy();
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
