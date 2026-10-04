// THE GYM'S UPDATES FOR A MEMBER, drawn (spec Part 3 §15.2; ROADMAP 19b-i). Only the
// network is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = { list: vi.fn(), react: vi.fn() };
vi.mock('../../api/postsApi', () => ({
  postsService: svc,
  postPhotoUrl: ({ gymId, postId, photoId }) => `http://api.test/v1/orgs/${gymId}/posts/${postId}/photos/${photoId}`,
}));
vi.mock('../../api/orgsApi', () => ({ errorText: (_err, fallback) => fallback }));

const Updates = (await import('./Updates')).default;

const GYM = { id: 'g1', name: 'Iron House' };
const post = (id, body, over = {}) => ({
  id,
  author: { name: 'Maya O.', initials: 'MO' },
  body,
  photos: [],
  pinned: false,
  createdAt: '2026-10-07T06:30:00.000Z',
  reactions: { like: 0, love: 0, strong: 0, fire: 0 },
  mine: null,
  ...over,
});
const feed = (over = {}) => ({ gymId: 'g1', gymName: 'Iron House', status: 'shown', pinned: [], posts: [], next: null, ...over });
const posts = () => screen.getAllByTestId('post');
const button = (card, name) => within(card).getByRole('button', { name });

beforeEach(() => {
  svc.list.mockReset();
  svc.react.mockReset();
});
afterEach(() => cleanup());

describe('the gym’s updates', () => {
  it('draws the pinned post first, then the rest, each with who posted and its words', async () => {
    svc.list.mockResolvedValue(
      feed({
        pinned: [post('pin', 'Closed on Friday', { pinned: true })],
        posts: [post('a', 'New racks\nCome and try them'), post('b', 'From the gym', { author: { name: null, initials: '' } })],
      }),
    );
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(svc.list).toHaveBeenCalledWith('g1');
    const [pinned, first, second] = posts();
    expect(within(pinned).getByText('Closed on Friday')).toBeTruthy();
    expect(within(pinned).getByText('Pinned')).toBeTruthy();
    expect(within(first).queryByText('Pinned')).toBeNull();
    expect(within(first).getByText('Maya O.')).toBeTruthy();
    expect(within(first).getByText('· Staff')).toBeTruthy();
    // The words keep their own lines.
    expect(within(first).getByText(/New racks/).className).toContain('whitespace-pre-wrap');
    // An author whose account is gone: the gym's own name, and no "Staff" beside it.
    expect(within(second).getByText('Iron House')).toBeTruthy();
    expect(within(second).queryByText('· Staff')).toBeNull();
  });

  it('shows a post’s photos, and a tap opens one full size', async () => {
    svc.list.mockResolvedValue(
      feed({
        posts: [
          post('a', '', {
            photos: [
              { id: 'ph1', width: 1200, height: 900 },
              { id: 'ph2', width: 900, height: 1200 },
            ],
          }),
        ],
      }),
    );
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(1));
    const images = within(posts()[0]).getAllByRole('img');
    expect(images.map((img) => img.getAttribute('src'))).toEqual([
      'http://api.test/v1/orgs/g1/posts/a/photos/ph1',
      'http://api.test/v1/orgs/g1/posts/a/photos/ph2',
    ]);
    fireEvent.click(button(posts()[0], 'Open photo 2 of 2'));
    const viewer = screen.getByRole('dialog', { name: 'Photo 2 of 2' });
    expect(within(viewer).getByRole('img').getAttribute('src')).toBe('http://api.test/v1/orgs/g1/posts/a/photos/ph2');
    fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    [feed(), "Iron House hasn't posted anything yet."],
    [feed({ status: 'paused' }), "Iron House's updates aren't showing at the moment."],
  ])('says so when there is nothing to show', async (given, line) => {
    svc.list.mockResolvedValue(given);
    render(<Updates gym={GYM} />);
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.queryAllByTestId('post')).toHaveLength(0);
  });

  it('says the read failed, never that the gym has posted nothing, and Try again reads again', async () => {
    svc.list.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(feed({ posts: [post('a', 'Back again')] }));
    render(<Updates gym={GYM} />);
    expect(await screen.findByText("Couldn't load the updates.")).toBeTruthy();
    expect(screen.queryByText(/hasn't posted anything/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back again')).toBeTruthy();
  });

  it('loads older posts on a tap and never shows one twice', async () => {
    svc.list
      .mockResolvedValueOnce(feed({ posts: [post('a', 'Newest'), post('b', 'Middle')], next: 'cursor-1' }))
      .mockResolvedValueOnce(feed({ posts: [post('b', 'Middle'), post('c', 'Oldest')], next: null }));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(svc.list).toHaveBeenLastCalledWith('g1', 'cursor-1');
    expect(posts().map((li) => li.textContent.includes('Oldest'))).toEqual([false, false, true]);
    expect(screen.queryByRole('button', { name: 'Show older posts' })).toBeNull();
  });
});

describe('reacting', () => {
  it('a tap sets the reaction at once and sends it; the server’s numbers are then shown', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('a', 'We reopen at six', { reactions: { like: 2, love: 0, strong: 0, fire: 0 } })] }));
    let answer;
    svc.react.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(1));
    const like = () => button(posts()[0], /^Like/);
    expect(like().getAttribute('aria-pressed')).toBe('false');
    expect(like().getAttribute('aria-label')).toBe('Like, 2 people');

    fireEvent.click(like());
    expect(svc.react).toHaveBeenCalledWith('g1', 'a', 'like');
    expect(like().getAttribute('aria-pressed')).toBe('true');
    expect(like().getAttribute('aria-label')).toBe('Like, 3 people, including you');
    // Somebody else tapped in the meantime: the server's count wins.
    answer({ reactions: { like: 5, love: 0, strong: 0, fire: 0 }, mine: 'like' });
    await waitFor(() => expect(like().getAttribute('aria-label')).toBe('Like, 5 people, including you'));
  });

  it('a tap on the reader’s own reaction takes it off; a tap on another changes it', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('a', 'x', { reactions: { like: 1, love: 0, strong: 0, fire: 0 }, mine: 'like' })] }));
    svc.react
      .mockResolvedValueOnce({ reactions: { like: 0, love: 0, strong: 0, fire: 1 }, mine: 'fire' })
      .mockResolvedValueOnce({ reactions: { like: 0, love: 0, strong: 0, fire: 0 }, mine: null });
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(1));
    fireEvent.click(button(posts()[0], /^Fire/));
    expect(svc.react).toHaveBeenLastCalledWith('g1', 'a', 'fire');
    await waitFor(() => expect(button(posts()[0], /^Fire/).getAttribute('aria-label')).toBe('Fire, 1 person, including you'));
    expect(button(posts()[0], /^Like/).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button(posts()[0], /^Fire/));
    expect(svc.react).toHaveBeenLastCalledWith('g1', 'a', null);
    await waitFor(() => expect(button(posts()[0], /^Fire/).getAttribute('aria-pressed')).toBe('false'));
  });

  it('a tap that fails is put back and said', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('a', 'x', { reactions: { like: 2, love: 0, strong: 0, fire: 0 } })] }));
    svc.react.mockRejectedValue(new Error('down'));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(1));
    fireEvent.click(button(posts()[0], /^Like/));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save your reaction. Please try again.");
    expect(button(posts()[0], /^Like/).getAttribute('aria-label')).toBe('Like, 2 people');
    expect(button(posts()[0], /^Like/).getAttribute('aria-pressed')).toBe('false');
  });

  it('there is nowhere to write a comment', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('a', 'x')] }));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(within(posts()[0]).getAllByRole('button')).toHaveLength(4);
  });
});
