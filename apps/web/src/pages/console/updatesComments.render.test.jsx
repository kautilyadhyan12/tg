// COMMENTS IN THE CONSOLE, DRAWN (ROADMAP Stage 5 17e-ii; spec Part 3 §15.2). Only the network is
// mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: remove a comment staff did not pick, or without the box that
// says who loses what; or name who reported one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const posts = { list: vi.fn(), reported: vi.fn(), stopped: vi.fn(), setStopped: vi.fn(), reactors: vi.fn() };
const svc = { list: vi.fn(), replies: vi.fn(), add: vi.fn(), remove: vi.fn(), reactors: vi.fn(), reported: vi.fn(), keep: vi.fn(), setMembersCanComment: vi.fn() };
const orgApi = { getMine: vi.fn() };
vi.mock('../../api/postsApi', () => ({
  staffPostsService: posts,
  staffCommentsService: svc,
  postPhotoUrl: () => 'http://api.test/photo',
}));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('./gymPagePhotos', () => ({ preparePostPhoto: vi.fn() }));

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
const NONE = { like: 0, love: 0, strong: 0, fire: 0 };
const post = (id, over = {}) => ({
  id,
  author: { name: 'Maya Okafor', initials: 'MO' },
  body: 'Leg day done',
  photos: [],
  pinned: false,
  createdAt: '2026-10-07T06:30:00.000Z',
  reactions: NONE,
  mine: null,
  fromMember: true,
  own: false,
  wrote: false,
  reported: false,
  hidden: false,
  commentCount: 0,
  challengeResult: null,
  authorId: 'u-maya',
  authorStopped: false,
  ...over,
});
const comment = (id, body, over = {}) => ({
  id,
  postId: 'p1',
  parentId: null,
  replyingTo: null,
  author: { name: 'Wendy Writer', initials: 'WW' },
  body,
  createdAt: '2026-10-07T07:30:00.000Z',
  reactions: NONE,
  fromMember: true,
  authorId: 'u-wendy',
  authorStopped: false,
  hidden: false,
  replyCount: 0,
  ...over,
});
const feed = (over = {}) => ({ gymId: 'g1', gymName: 'Iron House', membersCanPost: false, membersCanComment: true, reportedCount: 0, pinned: [], posts: [post('p1', { commentCount: 3 })], next: null, ...over });
const page = (comments, next = null) => ({ comments, next });
const reportedItem = (over = {}) => ({
  comment: comment('c1', 'Something unkind', { hidden: true }),
  post: { id: 'p1', body: 'Leg day done', fromMember: true, hidden: false, author: { name: 'Maya Okafor', initials: 'MO' } },
  reports: 5,
  reasons: { unkind: 4, nudity: 0, spam: 1, other: 0 },
  notes: ['This upset me'],
  allReports: 5,
  reportsMark: 'a'.repeat(32),
  ...over,
});
const refusal = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });

const open = async (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/updates']}>
      <Routes>
        <Route path="/console/:orgSlug/updates" element={<Updates />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('switch', { name: 'Members can comment' });
};
const openComments = async (name = 'Comments (3)') => {
  fireEvent.click(await screen.findByRole('button', { name }));
  return within(await screen.findByTestId('comments'));
};

beforeEach(() => {
  resetConsoleOrgs();
  for (const fn of [...Object.values(posts), ...Object.values(svc)]) fn.mockReset();
  posts.list.mockResolvedValue(feed());
  posts.reported.mockResolvedValue({ gymId: 'g1', gymName: 'Iron House', items: [], total: 0 });
  posts.stopped.mockResolvedValue({ people: [] });
  svc.reported.mockResolvedValue({ items: [], total: 0 });
  svc.list.mockResolvedValue(page([comment('c1', 'First one', { replyCount: 2 }), comment('c2', 'Second one', { author: { name: 'Sam Staff', initials: 'SS' }, fromMember: false, authorId: null })]));
});
afterEach(() => cleanup());

describe('reading a post’s comments', () => {
  it('opens under the post with its count, members and staff marked, and replies on a press', async () => {
    svc.replies.mockResolvedValue(page([comment('r1', 'A reply', { parentId: 'c1' }), comment('r2', 'A reply to it', { parentId: 'c1', replyingTo: 'Wendy Writer' })]));
    await open();
    const panel = await openComments();
    expect(await panel.findByText('First one')).toBeTruthy();
    const rows = panel.getAllByTestId('comment');
    expect(within(rows[0]).getByText('Member')).toBeTruthy();
    expect(within(rows[1]).getByText('Staff')).toBeTruthy();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Show 2 replies' }));
    expect(await panel.findByText('A reply')).toBeTruthy();
    expect(svc.replies).toHaveBeenCalledWith('g1', 'c1', undefined);
    expect(panel.getByText('Wendy Writer', { selector: 'span.c-w6[style]' }).textContent.trim()).toBe('Wendy Writer');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Hide replies' }));
    await waitFor(() => expect(panel.queryByText('A reply')).toBeNull());
  });

  it('says so when there are none, and when they could not be read', async () => {
    svc.list.mockResolvedValueOnce(page([]));
    await open();
    const panel = await openComments();
    expect(await panel.findByText('No comments yet.')).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    svc.list.mockRejectedValueOnce(refusal(500, 'Nope'));
    await open();
    const failed = await openComments();
    expect(await failed.findByRole('alert')).toBeTruthy();
  });

  it('shows more comments on a second page without losing the first', async () => {
    svc.list.mockResolvedValueOnce(page([comment('c1', 'First one')], 'cursor-1')).mockResolvedValueOnce(page([comment('c2', 'Second one')]));
    await open();
    const panel = await openComments();
    fireEvent.click(await panel.findByRole('button', { name: 'Show more comments' }));
    expect(await panel.findByText('Second one')).toBeTruthy();
    expect(panel.getByText('First one')).toBeTruthy();
    expect(svc.list).toHaveBeenLastCalledWith('g1', 'p1', 'cursor-1');
  });

  it('who reacted is a press on the comment’s own reaction, and asks for that comment', async () => {
    svc.list.mockResolvedValue(page([comment('c9', 'Liked', { reactions: { ...NONE, like: 2 } })]));
    svc.reactors.mockResolvedValue({ reaction: 'like', total: 2, people: [{ name: 'Lily Liker', initials: 'LL' }, { name: null, initials: '' }] });
    await open();
    const panel = await openComments();
    fireEvent.click(await panel.findByRole('button', { name: /See who/ }));
    expect(await panel.findByText('Lily Liker')).toBeTruthy();
    expect(panel.getByText('No name yet')).toBeTruthy();
    expect(svc.reactors).toHaveBeenCalledWith('g1', 'c9', 'like');
  });
});

describe('writing', () => {
  it('a comment goes on the post, is shown at once, adds one to the button, and one key sends it again after a lost reply', async () => {
    const made = comment('c3', 'Well done team', { author: { name: 'Olu Owner', initials: 'OO' }, fromMember: false, authorId: null });
    svc.add.mockRejectedValueOnce(refusal(500, 'Lost')).mockResolvedValueOnce({ comment: made, firstKept: true });
    await open();
    const panel = await openComments();
    const box = await panel.findByRole('textbox', { name: /Write a comment/ });
    const send = panel.getByRole('button', { name: 'Send comment' });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'Well done team' } });
    fireEvent.click(send);
    await panel.findByRole('alert');
    fireEvent.click(panel.getByRole('button', { name: 'Send comment' }));
    expect(await panel.findByText('Well done team')).toBeTruthy();
    expect(svc.add.mock.calls[0][2]).toBe(svc.add.mock.calls[1][2]);
    expect(svc.add.mock.calls[1].slice(0, 2)).toEqual(['g1', 'p1']);
    expect(svc.add.mock.calls[1][4]).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Comments (4)' })).toBeTruthy();
    expect(panel.getByRole('status').textContent).toBe('Comment sent. Your members can see it now.');
  });

  it('words changed after a failed send go under a new key, so the corrected words are what is kept', async () => {
    const made = comment('c3', 'Corrected', { fromMember: false, authorId: null });
    svc.add.mockRejectedValueOnce(refusal(500, 'Lost')).mockResolvedValueOnce({ comment: made, firstKept: true });
    await open();
    const panel = await openComments();
    const box = await panel.findByRole('textbox', { name: /Write a comment/ });
    fireEvent.change(box, { target: { value: 'Mistake' } });
    fireEvent.click(panel.getByRole('button', { name: 'Send comment' }));
    await panel.findByRole('alert');
    fireEvent.change(box, { target: { value: 'Corrected' } });
    fireEvent.click(panel.getByRole('button', { name: 'Send comment' }));
    await panel.findByText('Corrected', { selector: 'p' });
    expect(svc.add.mock.calls[1][2]).not.toBe(svc.add.mock.calls[0][2]);
    expect(svc.add.mock.calls[1][3]).toBe('Corrected');
  });

  it('on a post hidden after reports, the box and the answer say members cannot see it', async () => {
    posts.list.mockResolvedValue(feed({ posts: [post('p1', { commentCount: 3, hidden: true })] }));
    svc.add.mockResolvedValue({ comment: comment('c3', 'Sent', { fromMember: false, authorId: null }), firstKept: true });
    await open();
    const panel = await openComments();
    const box = await panel.findByRole('textbox', { name: /Write a comment/ });
    expect(panel.getByText(/Your members can't see this post until you keep it\./)).toBeTruthy();
    fireEvent.change(box, { target: { value: 'Sent' } });
    fireEvent.click(panel.getByRole('button', { name: 'Send comment' }));
    expect((await panel.findByRole('status')).textContent).toBe("Comment sent. Your members can't see it until you keep the post.");
  });

  it('a hidden comment and the replies under it offer no Reply', async () => {
    svc.list.mockResolvedValue(page([comment('c1', 'Hidden one', { hidden: true, replyCount: 1 })]));
    svc.replies.mockResolvedValue(page([comment('r1', 'Under it', { parentId: 'c1' })]));
    await open();
    const panel = await openComments();
    const row = within(await panel.findByTestId('comment'));
    expect(row.queryByRole('button', { name: 'Reply' })).toBeNull();
    fireEvent.click(row.getByRole('button', { name: 'Show 1 reply' }));
    await row.findByText('Under it');
    expect(row.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(row.getByRole('button', { name: 'Remove reply' })).toBeTruthy();
  });

  it('over 500 characters says how far over and cannot be sent; only spaces cannot be sent', async () => {
    await open();
    const panel = await openComments();
    const box = await panel.findByRole('textbox', { name: /Write a comment/ });
    fireEvent.change(box, { target: { value: 'x'.repeat(503) } });
    expect(panel.getByText(/3 characters too many/)).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Send comment' }).disabled).toBe(true);
    fireEvent.change(box, { target: { value: '    ' } });
    expect(panel.getByRole('button', { name: 'Send comment' }).disabled).toBe(true);
  });

  it('a reply opens its box under the comment pressed, and lands under it', async () => {
    const reply = comment('r3', 'Good effort', { parentId: 'c1', fromMember: false, authorId: null, author: { name: 'Olu Owner', initials: 'OO' } });
    svc.add.mockResolvedValue({ comment: reply, firstKept: true });
    svc.replies.mockResolvedValue(page([comment('r1', 'An older reply', { parentId: 'c1' }), reply]));
    await open();
    const panel = await openComments();
    const row = within((await panel.findAllByTestId('comment'))[0]);
    fireEvent.click(row.getByRole('button', { name: 'Reply' }));
    fireEvent.change(row.getByRole('textbox', { name: /Reply to Wendy Writer/ }), { target: { value: 'Good effort' } });
    fireEvent.click(row.getByRole('button', { name: 'Send reply' }));
    expect(await row.findByText('An older reply')).toBeTruthy();
    expect(row.getAllByText('Good effort')).toHaveLength(1);
    expect(svc.add.mock.calls[0][4]).toBe('c1');
    expect(screen.getByRole('button', { name: 'Comments (4)' })).toBeTruthy();
  });

  it('a gym whose plan has lapsed reads comments and can write and remove nothing', async () => {
    await open({ ...ORG, subscription: null, consoleReadOnly: true });
    const panel = await openComments();
    await panel.findByText('First one');
    expect(panel.queryByRole('textbox')).toBeNull();
    for (const name of ['Reply', 'Remove comment', 'Stop posting and commenting']) expect(panel.queryByRole('button', { name })).toBeNull();
  });
});

describe('a hidden comment away from the reported list', () => {
  it('on a person’s posts it names Updates and has a button there, and closes the box on the way', async () => {
    posts.person = vi.fn().mockResolvedValue({ posts: [post('p1', { commentCount: 1 })], next: null, total: 1 });
    svc.list.mockResolvedValue(page([comment('c1', 'Hidden one', { hidden: true })]));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'See what Maya Okafor has posted' }));
    const box = within(await screen.findByTestId('person-posts-box'));
    fireEvent.click(await box.findByRole('button', { name: 'Comments (1)' }));
    expect((await box.findByTestId('comment-hidden-note')).textContent).toBe('Hidden from your members: 5 or more people reported it. Choose Keep or Remove under Reported comments on Updates.');
    const link = box.getByRole('link', { name: 'Open Reported comments' });
    expect(link.getAttribute('href')).toBe('/console/iron-house/updates#reported-comments');
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByTestId('person-posts-box')).toBeNull());
  });

  it('lower on Updates it points up the page, with no button', async () => {
    svc.list.mockResolvedValue(page([comment('c1', 'Hidden one', { hidden: true })]));
    await open();
    const panel = await openComments();
    expect((await panel.findByTestId('comment-hidden-note')).textContent).toContain('at the top of this page');
    expect(panel.queryByRole('link', { name: 'Open Reported comments' })).toBeNull();
  });
});

describe('removing', () => {
  it('asks first, naming whose and how many replies go; Remove acts on that comment and no other', async () => {
    svc.remove.mockResolvedValue({ removed: true });
    await open();
    const panel = await openComments();
    const rows = await panel.findAllByTestId('comment');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Remove comment' }));
    const box = within(rows[0]).getByRole('group', { name: 'Remove this comment?' });
    expect(within(box).getByText("Wendy Writer's comment will be gone for all your members, with the 2 replies under it. Nobody is emailed, and nothing else changes.")).toBeTruthy();
    expect(svc.remove).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(svc.remove).not.toHaveBeenCalled();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Remove comment' }));
    fireEvent.click(within(within(rows[0]).getByRole('group', { name: 'Remove this comment?' })).getByRole('button', { name: 'Remove comment' }));
    await waitFor(() => expect(panel.queryByText('First one')).toBeNull());
    expect(svc.remove).toHaveBeenCalledTimes(1);
    expect(svc.remove).toHaveBeenCalledWith('g1', 'c1');
    expect(panel.getByText('Second one')).toBeTruthy();
    expect(panel.getByRole('status').textContent).toBe('Comment removed. Your members no longer see it.');
    // It took its two replies with it: the post had three, so none is left on the number.
    expect(screen.getByRole('button', { name: 'Comments' })).toBeTruthy();
  });

  it('one removed elsewhere says so and shows what is true now', async () => {
    svc.remove.mockRejectedValue(refusal(404, 'This comment has been removed.'));
    await open();
    const panel = await openComments();
    const rows = await panel.findAllByTestId('comment');
    svc.list.mockResolvedValue(page([comment('c2', 'Second one')]));
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Remove comment' }));
    fireEvent.click(within(within(rows[0]).getByRole('group', { name: 'Remove this comment?' })).getByRole('button', { name: 'Remove comment' }));
    expect((await panel.findByRole('alert')).textContent).toBe('This comment has been removed.');
    await waitFor(() => expect(panel.queryByText('First one')).toBeNull());
  });
});

describe('the reported comments', () => {
  const openReported = async (items = [reportedItem()]) => {
    svc.reported.mockResolvedValue({ items, total: items.length });
    await open();
    return within(await screen.findByTestId('reported-comment'));
  };

  it('says how many, why, what was typed, where it is and what each button does; never who', async () => {
    const card = await openReported();
    expect(screen.getByRole('heading', { name: '1 reported comment to look at' })).toBeTruthy();
    expect(screen.getByText(/Your members are never told who reported a comment, and neither are you\./)).toBeTruthy();
    expect(card.getByText('Reported by 5 people: Bullying or unkind (4) · Spam or selling (1)')).toBeTruthy();
    expect(card.getByText('“This upset me”')).toBeTruthy();
    expect(card.getByText("A comment on Maya Okafor's post")).toBeTruthy();
    expect(card.getByText('Leg day done')).toBeTruthy();
    expect(card.getByTestId('comment-hidden-note').textContent).toBe('Hidden from your members: 5 or more people reported it. Keep comment shows it to them again.');
  });

  it('Keep sends what the list counted; a report that came meanwhile says so and the list is read again', async () => {
    const card = await openReported();
    svc.keep.mockResolvedValueOnce({ kept: false, waiting: 1 });
    fireEvent.click(card.getByRole('button', { name: 'Keep comment' }));
    await waitFor(() => expect(svc.keep).toHaveBeenCalledWith('g1', 'c1', expect.objectContaining({ allReports: 5, reportsMark: 'a'.repeat(32) })));
    const section = within(screen.getByTestId('reported-comments'));
    expect((await section.findByRole('status')).textContent).toBe('1 more person reported this comment while you were looking, so it is still on this list. Read what is new, then choose again.');
    expect(svc.reported).toHaveBeenCalledTimes(2);
  });

  it('Keep done: says the comment is back, leaves the list, and stays said when it was the last', async () => {
    const card = await openReported();
    svc.keep.mockResolvedValueOnce({ kept: true, waiting: 0 });
    svc.reported.mockResolvedValue({ items: [], total: 0 });
    fireEvent.click(card.getByRole('button', { name: 'Keep comment' }));
    const section = within(await screen.findByTestId('reported-comments'));
    expect((await section.findByRole('status')).textContent).toBe('Kept. Your members can see the comment again, and it has left this list.');
    await waitFor(() => expect(screen.queryByTestId('reported-comment')).toBeNull());
  });

  it('Remove asks first, then takes that comment, and the post’s number with it', async () => {
    const card = await openReported();
    svc.remove.mockResolvedValue({ removed: true });
    svc.reported.mockResolvedValue({ items: [], total: 0 });
    fireEvent.click(card.getByRole('button', { name: 'Remove comment' }));
    expect(svc.remove).not.toHaveBeenCalled();
    fireEvent.click(within(card.getByRole('group', { name: 'Remove this comment?' })).getByRole('button', { name: 'Remove comment' }));
    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith('g1', 'c1'));
    expect(await screen.findByRole('button', { name: 'Comments (2)' })).toBeTruthy();
  });

  it('opens the post’s comments in place, and they are read again after an answer', async () => {
    const card = await openReported();
    fireEvent.click(card.getByRole('button', { name: "See this post's comments" }));
    await within(await card.findByTestId('comments')).findByText('First one');
    expect(svc.list).toHaveBeenCalledTimes(1);
    svc.keep.mockResolvedValueOnce({ kept: false, waiting: 1 });
    fireEvent.click(card.getByRole('button', { name: 'Keep comment' }));
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it('a reply is called a reply, and Stop on it stops that person', async () => {
    const reply = comment('r1', 'Rude reply', { parentId: 'c1' });
    const card = await openReported([reportedItem({ comment: reply, notes: [], reports: 1, reasons: { unkind: 1, nudity: 0, spam: 0, other: 0 } })]);
    expect(card.getByText("A reply on Maya Okafor's post")).toBeTruthy();
    expect(card.queryByTestId('comment-report-notes')).toBeNull();
    expect(card.getByRole('button', { name: 'Remove reply' })).toBeTruthy();
    posts.setStopped.mockResolvedValue({ stopped: true });
    fireEvent.click(card.getByRole('button', { name: 'Stop posting and commenting' }));
    fireEvent.click(within(card.getByRole('group', { name: 'Stop Wendy Writer posting and commenting?' })).getByRole('button', { name: 'Stop Wendy Writer posting and commenting' }));
    await waitFor(() => expect(posts.setStopped).toHaveBeenCalledWith('g1', 'u-wendy', true));
  });

  it('coming back to the window reads the list, the switches and the numbers again', async () => {
    await open();
    expect(svc.reported).toHaveBeenCalledTimes(1);
    posts.list.mockResolvedValue(feed({ membersCanComment: false, posts: [post('p1', { commentCount: 9 })] }));
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(svc.reported).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Members can comment' }).getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByRole('button', { name: 'Comments (9)' })).toBeTruthy();
  });

  it('coming back keeps a second page already opened, and drops one the first page no longer holds', async () => {
    svc.list.mockResolvedValueOnce(page([comment('c1', 'Gone soon', { createdAt: '2026-10-07T07:00:00.000Z' }), comment('c2', 'Stays', { createdAt: '2026-10-07T07:10:00.000Z' })], 'cur')).mockResolvedValueOnce(page([comment('c3', 'On page two', { createdAt: '2026-10-07T07:20:00.000Z' })]));
    await open();
    const panel = await openComments();
    fireEvent.click(await panel.findByRole('button', { name: 'Show more comments' }));
    await panel.findByText('On page two');
    svc.list.mockResolvedValueOnce(page([comment('c2', 'Stays', { createdAt: '2026-10-07T07:10:00.000Z' })], 'cur2'));
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(panel.queryByText('Gone soon')).toBeNull());
    expect(panel.getByText('On page two')).toBeTruthy();
  });

  it('a gym that can change nothing is not told to press Keep', async () => {
    svc.reported.mockResolvedValue({ items: [reportedItem()], total: 1 });
    await open({ ...ORG, subscription: null, consoleReadOnly: true });
    const card = within(await screen.findByTestId('reported-comment'));
    expect(card.getByTestId('comment-hidden-note').textContent).toBe('Hidden from your members: 5 or more people reported it.');
    expect(card.queryByRole('button', { name: 'Keep comment' })).toBeNull();
  });
});

describe('the switch', () => {
  it('says what it does each way and saves on the press', async () => {
    svc.setMembersCanComment.mockResolvedValue({ membersCanComment: false });
    await open();
    const theSwitch = screen.getByRole('switch', { name: 'Members can comment' });
    expect(theSwitch.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Your members can comment on posts and reply to each other. You can remove any comment, and stop a person posting and commenting.')).toBeTruthy();
    fireEvent.click(theSwitch);
    expect((await screen.findByRole('status')).textContent).toBe('Members can no longer comment. The comments they already made stay until you remove them.');
    expect(svc.setMembersCanComment).toHaveBeenCalledWith('g1', false);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Members can comment' }).getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByText('Only your staff can comment. Switch this on to let your members comment too.')).toBeTruthy();
  });

  it('the stopped list says it stops comments too', async () => {
    posts.stopped.mockResolvedValue({ people: [{ userId: 'u-1', name: 'Barry Bully', initials: 'BB', stoppedAt: '2026-10-07T06:30:00.000Z' }] });
    await open();
    expect(await screen.findByText('They can read and react, but not post or comment, until you let them again.')).toBeTruthy();
  });
});
