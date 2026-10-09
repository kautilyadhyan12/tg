// THE MEMBER'S INBOX FROM THEIR GYM, drawn (spec Part 3 §16.1; ROADMAP 20a). Only the
// network is mocked: what a member sees is read off the real component and its real hook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = { read: vi.fn(), markRead: vi.fn() };
vi.mock('../../api/inboxApi', () => ({ inboxService: svc }));
vi.mock('../../api/orgsApi', () => ({
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
}));

const Inbox = (await import('./Inbox')).default;
const { useGymInbox } = await import('../../hooks/useGymInbox');
const { unreadBadge } = await import('./inboxView');

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();
const GYM = { id: 'g1', name: 'Iron House', latestCheer: null, latestNudge: null };
const message = (id, body, over = {}) => ({ id, kind: 'welcome', body, sentAt: ago(2), read: false, ...over });
const inboxOf = (messages, over = {}) => ({
  gymId: 'g1',
  gymName: 'Iron House',
  status: 'shown',
  messages,
  unread: messages.filter((m) => !m.read).length,
  asOf: '2026-10-09T06:35:00.000Z',
  ...over,
});

/** The page around the inbox: the tab's count, and the inbox itself once `open`. */
function Page({ gym = GYM, open = true }) {
  const inbox = useGymInbox(gym.id);
  return (
    <>
      <p data-testid="count">{unreadBadge(inbox.unread) ?? 'none'}</p>
      {open ? <Inbox gym={gym} inbox={inbox} /> : null}
    </>
  );
}
const count = () => screen.getByTestId('count').textContent;
const rows = () => within(screen.getByRole('list', { name: 'Messages from Iron House' })).getAllByRole('listitem').map((li) => li.textContent);

// In braces: a function a `beforeEach` returns is called again as its tidy-up.
beforeEach(() => {
  svc.read.mockReset();
  svc.markRead.mockReset();
});
afterEach(cleanup);

describe("a member's inbox from their gym", () => {
  it('lists the messages newest first, the unread ones marked New, with what the inbox is', async () => {
    svc.read.mockResolvedValue(inboxOf([message('m2', 'Happy birthday, Maya.', { sentAt: ago(1) }), message('m1', 'Welcome to Iron House, Maya.', { sentAt: ago(30), read: true })]));
    svc.markRead.mockResolvedValue(0);
    render(<Page />);
    expect(screen.getByText('Loading your messages…')).toBeTruthy();
    await waitFor(() => expect(rows()).toEqual(['Happy birthday, Maya.New · 1 hour ago', 'Welcome to Iron House, Maya.1 day ago']));
    expect(screen.getByText("Messages stay here for 30 days. You can't reply to them here.")).toBeTruthy();
    expect(svc.read).toHaveBeenCalledTimes(1);
    expect(svc.read).toHaveBeenCalledWith('g1');
  });

  it('says how many are new before it is opened; opening it tells the server once, with the read it was shown, and the count goes', async () => {
    svc.read.mockResolvedValue(inboxOf([message('m2', 'Two'), message('m1', 'One')]));
    svc.markRead.mockResolvedValue(0);
    const { rerender } = render(<Page open={false} />);
    await waitFor(() => expect(count()).toBe('2'));
    expect(svc.markRead).not.toHaveBeenCalled();

    rerender(<Page open />);
    await waitFor(() => expect(count()).toBe('none'));
    expect(svc.markRead).toHaveBeenCalledTimes(1);
    expect(svc.markRead).toHaveBeenCalledWith('g1', '2026-10-09T06:35:00.000Z');
    // What was new when it opened is still marked New on this view.
    expect(rows()).toEqual(['TwoNew · 2 hours ago', 'OneNew · 2 hours ago']);
    expect(svc.read).toHaveBeenCalledTimes(1);
  });

  it('keeps the count when the server could not be told, and one that came since stays counted', async () => {
    svc.read.mockResolvedValue(inboxOf([message('m1', 'One')]));
    svc.markRead.mockRejectedValue(new Error('offline'));
    const first = render(<Page />);
    await waitFor(() => expect(svc.markRead).toHaveBeenCalledTimes(1));
    expect(count()).toBe('1');
    first.unmount();

    svc.markRead.mockReset();
    svc.markRead.mockResolvedValue(1);
    render(<Page />);
    await waitFor(() => expect(svc.markRead).toHaveBeenCalled());
    await waitFor(() => expect(count()).toBe('1'));
    expect(svc.markRead.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('with nothing new, tells the server nothing', async () => {
    svc.read.mockResolvedValue(inboxOf([message('m1', 'One', { read: true })]));
    render(<Page />);
    await waitFor(() => expect(rows()).toEqual(['One2 hours ago']));
    expect(svc.markRead).not.toHaveBeenCalled();
  });

  it('an empty inbox says so, and never looks like a failed one', async () => {
    svc.read.mockResolvedValue(inboxOf([]));
    render(<Page />);
    expect(await screen.findByText('No messages from Iron House yet. When they send you one, it shows up here.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('a read that failed says so, and Try again reads it again', async () => {
    svc.read.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500, data: {} } }));
    svc.read.mockResolvedValueOnce(inboxOf([message('m1', 'One', { read: true })]));
    render(<Page />);
    expect(await screen.findByText("Couldn't load your messages.")).toBeTruthy();
    expect(screen.queryByText(/No messages from/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rows()).toEqual(['One2 hours ago']));
    expect(svc.read).toHaveBeenCalledTimes(2);
  });

  it('a gym that is closed or on no plan shows no messages, and says why', async () => {
    svc.read.mockResolvedValue(inboxOf([], { status: 'paused' }));
    render(<Page />);
    expect(await screen.findByText("Iron House isn't sending messages in the app right now.")).toBeTruthy();
    expect(screen.queryByText(/No messages from/)).toBeNull();
  });

  it("pins the gym's newest cheer or come-back line above the messages, and alone when there are none", async () => {
    svc.read.mockResolvedValue(inboxOf([message('m1', 'One', { read: true })]));
    const gym = { ...GYM, latestCheer: { preset: 'on_a_roll', sentAt: ago(50) }, latestNudge: { preset: 'miss_you', sentAt: ago(3) } };
    const first = render(<Page gym={gym} />);
    expect(await screen.findByText('We miss you — hope to see you soon.')).toBeTruthy();
    expect(screen.getByText('Pinned · 3 hours ago')).toBeTruthy();
    expect(screen.queryByText("You're on a roll.")).toBeNull();
    expect(rows()).toEqual(['One2 hours ago']);
    first.unmount();

    svc.read.mockResolvedValue(inboxOf([]));
    render(<Page gym={{ ...GYM, latestCheer: { preset: 'on_a_roll', sentAt: ago(1) } }} />);
    expect(await screen.findByText("You're on a roll.")).toBeTruthy();
    expect(screen.queryByText(/No messages from/)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it("another gym's page reads that gym's inbox, and shows none of the first one's", async () => {
    svc.read.mockImplementation((gymId) =>
      Promise.resolve(gymId === 'g1' ? inboxOf([message('m1', 'From Iron House', { read: true })]) : inboxOf([], { gymId: 'g2', gymName: 'Steel Yard' })),
    );
    const { rerender } = render(<Page />);
    expect(await screen.findByText('From Iron House')).toBeTruthy();
    rerender(<Page gym={{ id: 'g2', name: 'Steel Yard', latestCheer: null, latestNudge: null }} />);
    expect(await screen.findByText('No messages from Steel Yard yet. When they send you one, it shows up here.')).toBeTruthy();
    expect(screen.queryByText('From Iron House')).toBeNull();
    expect(svc.read.mock.calls.map((c) => c[0])).toEqual(['g1', 'g2']);
  });
});
