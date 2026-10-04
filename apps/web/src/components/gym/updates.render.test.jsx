// THE GYM'S UPDATES FOR A MEMBER, drawn (spec Part 3 §15.2; ROADMAP 19b-i). Only the
// network is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = { list: vi.fn(), react: vi.fn(), add: vi.fn(), removeOwn: vi.fn(), report: vi.fn() };
const prepare = vi.fn();
vi.mock('../../api/postsApi', () => ({
  postsService: svc,
  postPhotoUrl: ({ gymId, postId, photoId }) => `http://api.test/v1/orgs/${gymId}/posts/${postId}/photos/${photoId}`,
}));
vi.mock('../../pages/console/gymPagePhotos', () => ({ preparePagePhoto: prepare }));
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
  fromMember: false,
  own: false,
  wrote: false,
  reported: false,
  ...over,
});
const feed = (over = {}) => ({ gymId: 'g1', gymName: 'Iron House', status: 'shown', posting: 'off', pinned: [], posts: [], next: null, ...over });
const posts = () => screen.getAllByTestId('post');
const button = (card, name) => within(card).getByRole('button', { name });

beforeEach(() => {
  for (const fn of [...Object.values(svc), prepare]) fn.mockReset();
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
    // The four reactions and Report: nothing else to press on somebody's post.
    expect(within(posts()[0]).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim())).toEqual([
      'Like, 0 people',
      'Love, 0 people',
      'Strong, 0 people',
      'Fire, 0 people',
      'Report',
    ]);
  });
});

describe('a member posts', () => {
  const composer = () => within(screen.getByTestId('composer'));

  it.each(['off', 'stopped'])('there is no box to write in while posting is %s, and a stopped member is told why', async (posting) => {
    svc.list.mockResolvedValue(feed({ posting, posts: [post('a', 'x')] }));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByTestId('composer')).toBeNull();
    const note = screen.queryByText('The staff at Iron House have stopped you posting here. Speak to them at the front desk.');
    expect(note !== null).toBe(posting === 'stopped');
  });

  it('the box is there on an empty page, sends the words and photos under one key, and shows the post at the top', async () => {
    svc.list.mockResolvedValue(feed({ posting: 'on' }));
    prepare.mockResolvedValue({ key: 'new-1', uploadKey: 'up-1', base64: 'BASE64', preview: 'blob:one' });
    svc.add.mockResolvedValue({ post: post('mine', 'First time on the rower', { fromMember: true, own: true, wrote: true, author: { name: 'Ina I.', initials: 'II' } }) });
    render(<Updates gym={GYM} />);
    await screen.findByText('No posts yet. Write the first one.');
    const send = composer().getByRole('button', { name: 'Post' });
    expect(send.disabled).toBe(true);
    expect(composer().getByText(/You can post 10 times a day/)).toBeTruthy();

    fireEvent.change(composer().getByRole('textbox', { name: /Write a post/ }), { target: { value: 'First time on the rower' } });
    fireEvent.change(composer().getByLabelText('Choose photos'), { target: { files: [new File(['x'], 'rower.jpg', { type: 'image/jpeg' })] } });
    await composer().findByAltText('Photo 1 of 1');
    fireEvent.click(send);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(svc.add).toHaveBeenCalledTimes(1);
    const [gymId, key, body, photos] = svc.add.mock.calls[0];
    expect([gymId, body, photos]).toEqual(['g1', 'First time on the rower', ['BASE64']]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(within(posts()[0]).getByText('Ina I.')).toBeTruthy();
    // Their own post: Remove, and nothing to report.
    expect(within(posts()[0]).queryByRole('button', { name: 'Report' })).toBeNull();
    expect(button(posts()[0], 'Remove')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Posted. Everyone at Iron House can see it now.');
    expect(composer().getByRole('textbox', { name: /Write a post/ }).value).toBe('');
  });

  it('a post the server refuses keeps its words and says why in the server’s words', async () => {
    svc.list.mockResolvedValue(feed({ posting: 'on' }));
    svc.add.mockRejectedValue(new Error('refused'));
    render(<Updates gym={GYM} />);
    await screen.findByTestId('composer');
    fireEvent.change(composer().getByRole('textbox', { name: /Write a post/ }), { target: { value: 'Eleventh today' } });
    fireEvent.click(composer().getByRole('button', { name: 'Post' }));
    expect((await composer().findByRole('alert')).textContent).toBe("We couldn't post that. Please try again.");
    expect(composer().getByRole('textbox', { name: /Write a post/ }).value).toBe('Eleventh today');
  });
});

describe('removing one’s own post, and reporting somebody else’s', () => {
  const three = () =>
    feed({
      posting: 'on',
      posts: [
        post('theirs', 'Somebody else wrote this', { fromMember: true }),
        post('mine', 'I wrote this', { fromMember: true, own: true, wrote: true }),
        post('seen', 'Already reported', { fromMember: true, reported: true }),
      ],
    });

  it('Remove is on the member’s own post alone, asks first, and removes the post it was pressed on', async () => {
    svc.list.mockResolvedValue(three());
    svc.removeOwn.mockResolvedValue({ removed: true });
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(within(posts()[0]).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(posts()[2]).queryByRole('button', { name: 'Remove' })).toBeNull();

    fireEvent.click(button(posts()[1], 'Remove'));
    const box = within(within(posts()[1]).getByRole('group', { name: 'Remove your post?' }));
    expect(box.getByText("Your post will disappear for everyone at Iron House. This can't be undone.")).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Keep post' }));
    expect(svc.removeOwn).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(3);

    fireEvent.click(button(posts()[1], 'Remove'));
    fireEvent.click(within(posts()[1]).getByRole('button', { name: 'Remove post' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(svc.removeOwn.mock.calls).toEqual([['g1', 'mine']]);
    expect(posts().map((p) => p.textContent.includes('I wrote this'))).toEqual([false, false]);
  });

  it('Report asks why, sends the reason for the post it was pressed on, and then reads Reported', async () => {
    svc.list.mockResolvedValue(three());
    svc.report.mockResolvedValue({ reported: true });
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(3));
    // One already reported says so and offers no second report; one's own offers none.
    expect(within(posts()[2]).getByText('Reported')).toBeTruthy();
    expect(within(posts()[2]).queryByRole('button', { name: 'Report' })).toBeNull();
    expect(within(posts()[1]).queryByRole('button', { name: 'Report' })).toBeNull();

    fireEvent.click(button(posts()[0], 'Report'));
    const box = within(within(posts()[0]).getByRole('group', { name: 'Report this post' }));
    expect(box.getByText("The staff at Iron House will look at it. The person who posted isn't told who reported it.")).toBeTruthy();
    const send = box.getByRole('button', { name: 'Send report' });
    expect(send.disabled).toBe(true);
    expect(box.getAllByRole('radio')).toHaveLength(5);
    fireEvent.click(box.getByRole('radio', { name: "A photo of someone who didn't agree to it" }));
    fireEvent.click(send);
    await waitFor(() => expect(within(posts()[0]).getByText('Reported')).toBeTruthy());
    // Nothing typed: the reason alone.
    expect(svc.report.mock.calls).toEqual([['g1', 'theirs', 'photo_of_someone', '']]);
    expect(within(posts()[0]).queryByRole('group', { name: 'Report this post' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Reported. The staff at Iron House will look at it.');
  });

  it('a member can type more beside the reason: it is sent with the report, and too much holds Send', async () => {
    svc.list.mockResolvedValue(three());
    svc.report.mockResolvedValue({ reported: true });
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(3));
    fireEvent.click(button(posts()[0], 'Report'));
    const box = within(within(posts()[0]).getByRole('group', { name: 'Report this post' }));
    const more = box.getByRole('textbox', { name: /Tell the staff more/ });
    expect(box.getByText('300 characters left')).toBeTruthy();
    fireEvent.click(box.getByRole('radio', { name: 'Bullying or unkind' }));
    fireEvent.change(more, { target: { value: 'a'.repeat(301) } });
    expect(box.getByText('1 character too many')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Send report' }).disabled).toBe(true);
    // Typing alone, with no reason picked, never sends: the reason is still asked.
    fireEvent.change(more, { target: { value: 'He says this to her every week' } });
    fireEvent.click(box.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(within(posts()[0]).getByText('Reported')).toBeTruthy());
    expect(svc.report.mock.calls).toEqual([['g1', 'theirs', 'unkind', 'He says this to her every week']]);
  });

  it('staff who also train see neither Report nor Remove on a post they wrote for the gym', async () => {
    svc.list.mockResolvedValue(feed({ posts: [post('gym', 'From the gym, by me', { wrote: true })] }));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(within(posts()[0]).queryByRole('button', { name: 'Report' })).toBeNull();
    expect(within(posts()[0]).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(posts()[0]).getAllByRole('button')).toHaveLength(4);
  });

  it('a report that fails says so, keeps the box open, and Cancel sends nothing', async () => {
    svc.list.mockResolvedValue(three());
    svc.report.mockRejectedValue(new Error('down'));
    render(<Updates gym={GYM} />);
    await waitFor(() => expect(posts()).toHaveLength(3));
    fireEvent.click(button(posts()[0], 'Report'));
    const box = within(within(posts()[0]).getByRole('group', { name: 'Report this post' }));
    fireEvent.click(box.getByRole('radio', { name: 'Spam or selling' }));
    fireEvent.click(box.getByRole('button', { name: 'Send report' }));
    expect((await box.findByRole('alert')).textContent).toBe("That didn't work. Please try again.");
    expect(within(posts()[0]).queryByText('Reported')).toBeNull();
    fireEvent.click(box.getByRole('button', { name: 'Cancel' }));
    expect(within(posts()[0]).queryByRole('group', { name: 'Report this post' })).toBeNull();
    expect(svc.report).toHaveBeenCalledTimes(1);
  });
});
