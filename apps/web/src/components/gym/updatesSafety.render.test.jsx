// BLOCK, A POST WAITING FOR STAFF AND THE HELP LINE, FOR A MEMBER, drawn (spec Part 3
// §15.3; ROADMAP 19b-ii-b). Only the network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = { list: vi.fn(), react: vi.fn(), add: vi.fn(), removeOwn: vi.fn(), report: vi.fn(), block: vi.fn(), blocked: vi.fn(), unblock: vi.fn() };
vi.mock('../../api/postsApi', () => ({
  postsService: svc,
  postPhotoUrl: ({ gymId, postId, photoId }) => `http://api.test/v1/orgs/${gymId}/posts/${postId}/photos/${photoId}`,
}));
vi.mock('../../pages/console/gymPagePhotos', () => ({ preparePagePhoto: vi.fn() }));
vi.mock('../../api/orgsApi', () => ({ errorText: (_err, fallback) => fallback }));

const Updates = (await import('./Updates')).default;

const GYM = { id: 'g1', name: 'Iron House' };
const post = (id, body, over = {}) => ({
  id,
  author: { name: 'Barry B.', initials: 'BB' },
  body,
  photos: [],
  pinned: false,
  createdAt: '2026-10-07T06:30:00.000Z',
  reactions: { like: 2, love: 0, strong: 0, fire: 0 },
  mine: null,
  fromMember: true,
  own: false,
  wrote: false,
  reported: false,
  held: false,
  ...over,
});
const feed = (over = {}) => ({ gymId: 'g1', gymName: 'Iron House', status: 'shown', posting: 'on', blockedCount: 0, supportEmail: null, pinned: [], posts: [], next: null, ...over });
const posts = () => screen.getAllByTestId('post');

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
});
afterEach(() => cleanup());

describe('Block', () => {
  const page = () =>
    feed({
      posts: [
        post('theirs', 'Look who skipped leg day'),
        post('gym', 'Closed on Monday', { fromMember: false, author: { name: 'Maya O.', initials: 'MO' } }),
        post('mine', 'I wrote this', { own: true, wrote: true, author: { name: 'Rita R.', initials: 'RR' } }),
      ],
    });

  it('is on another member\'s post only, asks first, and the page is then read again without them', async () => {
    svc.list.mockResolvedValueOnce(page()).mockResolvedValue(feed({ blockedCount: 1, posts: [page().posts[1], page().posts[2]] }));
    svc.block.mockResolvedValue({ blocked: true });
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(within(posts()[1]).queryByRole('button', { name: 'Block' })).toBeNull();
    expect(within(posts()[2]).queryByRole('button', { name: 'Block' })).toBeNull();
    expect(screen.queryByRole('button', { name: /People you've blocked/ })).toBeNull();

    fireEvent.click(within(posts()[0]).getByRole('button', { name: 'Block' }));
    const box = within(within(posts()[0]).getByRole('group', { name: 'Block Barry B.?' }));
    expect(
      box.getByText("You won't see Barry B.'s posts or reactions at Iron House any more. They aren't told, and nothing changes for anyone else. You can unblock them at the bottom of Updates."),
    ).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Cancel' }));
    expect(svc.block).not.toHaveBeenCalled();

    fireEvent.click(within(posts()[0]).getByRole('button', { name: 'Block' }));
    fireEvent.click(within(posts()[0]).getByRole('button', { name: 'Block Barry B.' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(svc.block.mock.calls).toEqual([['g1', 'theirs']]);
    expect(svc.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Look who skipped leg day')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe("Blocked. You won't see Barry B.'s posts or reactions any more.");
    expect(screen.getByRole('button', { name: "People you've blocked (1)" })).toBeTruthy();
  });

  it('a block that fails says so, keeps the box open and changes nothing', async () => {
    svc.list.mockResolvedValue(page());
    svc.block.mockRejectedValue(new Error('down'));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(3));
    fireEvent.click(within(posts()[0]).getByRole('button', { name: 'Block' }));
    fireEvent.click(within(posts()[0]).getByRole('button', { name: 'Block Barry B.' }));
    expect((await within(posts()[0]).findByRole('alert')).textContent).toBe("That didn't work. Please try again.");
    expect(within(posts()[0]).getByRole('group', { name: 'Block Barry B.?' })).toBeTruthy();
    expect(posts()).toHaveLength(3);
    expect(svc.list).toHaveBeenCalledTimes(1);
  });

  it('the blocked list names each person, and Unblock takes off the one it was pressed on and reads the page again', async () => {
    const two = { people: [{ id: 'b1', name: 'Barry B.', initials: 'BB', blockedAt: '2026-10-07T06:30:00.000Z' }, { id: 'b2', name: null, initials: '', blockedAt: '2026-10-06T06:30:00.000Z' }] };
    svc.list.mockResolvedValueOnce(feed({ blockedCount: 2 })).mockResolvedValue(feed({ blockedCount: 1, posts: [post('theirs', 'Back again')] }));
    svc.blocked.mockResolvedValue(two);
    svc.unblock.mockResolvedValue({ blocked: false });
    render(<Updates gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: "People you've blocked (2)" }));
    const list = within(await screen.findByTestId('blocked'));
    await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(2));
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Barry B.Unblock', 'A memberUnblock']);
    expect(list.getByText("You don't see their posts or reactions here. They aren't told.")).toBeTruthy();

    fireEvent.click(within(list.getAllByRole('listitem')[0]).getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(1));
    expect(svc.unblock.mock.calls).toEqual([['g1', 'b1']]);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.getByRole('status').textContent).toBe("Unblocked. You'll see Barry B.'s posts and reactions again.");
  });
});

describe('a post waiting for staff', () => {
  it('says so on the writer\'s own post, with no reactions to press, and Remove still there', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('held', 'what a tosser', { own: true, wrote: true, held: true }), post('fine', 'Morning all', { own: true, wrote: true })] }));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(within(posts()[0]).getByTestId('held-note').textContent).toBe('Waiting for the staff at Iron House to check it. Only you can see it until they do.');
    expect(within(posts()[0]).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Remove']);
    expect(within(posts()[1]).queryByTestId('held-note')).toBeNull();
    expect(within(posts()[1]).getAllByRole('button')).toHaveLength(5);
  });

  it('a new post that is held is said to be waiting, never "everyone can see it"', async () => {
    svc.list.mockResolvedValue(feed());
    svc.add.mockResolvedValue({ post: post('new', 'what a tosser', { own: true, wrote: true, held: true }) });
    render(<Updates gym={GYM} />);
    const composer = within(await screen.findByTestId('composer'));
    fireEvent.change(composer.getByRole('textbox', { name: /Write a post/ }), { target: { value: 'what a tosser' } });
    fireEvent.click(composer.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.getByRole('status').textContent).toBe('Your post is waiting for the staff at Iron House to check it. Only you can see it until they do.');
    expect(screen.queryByText(/Everyone at Iron House can see it now/)).toBeNull();
  });
});

describe('the help line', () => {
  it('shows the support address as a link once one is set, and nothing before', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('a', 'Morning all')] }));
    const first = render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByTestId('help-line')).toBeNull();
    first.unmount();

    svc.list.mockResolvedValue(feed({ supportEmail: 'help@example.com', posts: [post('a', 'Morning all')] }));
    render(<Updates gym={GYM} />);
    const line = await screen.findByTestId('help-line');
    expect(line.textContent).toBe('Need help with the app? Email help@example.com');
    expect(within(line).getByRole('link', { name: 'help@example.com' }).getAttribute('href')).toBe('mailto:help@example.com');
  });
});
