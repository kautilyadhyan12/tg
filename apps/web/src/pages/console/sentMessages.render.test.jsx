// Sent messages (ROADMAP 20f-ii; spec Part 3 §16.8): the list of what a gym sent to groups.
//
// The worst thing on this screen is one gym's messages, whose words can name a member,
// shown where they should not be: the page asks only for the gym in its address, and asks
// nothing at all for staff who may not send a message.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GYM_SENT_MESSAGES_KEPT_WORDS, gymSentMessagesResponseSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getMine: vi.fn(), getSentMessages: vi.fn() } };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const MembersSentMessages = (await import('./MembersSentMessages')).default;
const { sentToWords, sentWhen } = await import('./memberListPeople');

const GYM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

const gymRow = (more = {}) => ({
  id: GYM,
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  clockFormat: '12h',
  country: 'US',
  status: 'active',
  staffRole: 'owner',
  isMember: false,
  privileges: ['members.read', 'members.confirm'],
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: 200 },
  ...more,
});
const otherRow = { ...gymRow(), id: OTHER, slug: 'oak-studio', name: 'Oak Studio' };

const message = (n, more = {}) => ({ id: id(n), body: `Notice ${String(n)}`, sentByName: 'Jordan Hayes', sentAt: '2026-10-09T17:05:00.000Z', people: 12, ...more });
const answer = (messages, next = null) => ({ data: gymSentMessagesResponseSchema.parse({ page: { messages, next } }) });

const draw = (slug = 'iron-house') =>
  render(
    <MemoryRouter initialEntries={[`/console/${slug}/members/sent-messages`]}>
      <Routes>
        <Route path="/console/:orgSlug/members/sent-messages" element={<MembersSentMessages />} />
        <Route path="/console/:orgSlug/members" element={<p>the members page</p>} />
      </Routes>
    </MemoryRouter>,
  );
const rows = () => screen.findAllByTestId('sent-message');

beforeEach(() => {
  vi.resetAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [gymRow(), otherRow] } });
});
afterEach(() => cleanup());

describe('the words of a sent message', () => {
  it("when it was sent, on the gym's own calendar and clock", () => {
    // 17:05 UTC is 12:05 in Chicago; 23:30 UTC on the 9th is the 10th in Kolkata.
    expect(sentWhen('2026-10-09T17:05:00.000Z', 'America/Chicago', '12h')).toBe('9 October 2026, 12:05 PM');
    expect(sentWhen('2026-10-09T17:05:00.000Z', 'America/Chicago', '24h')).toBe('9 October 2026, 12:05');
    expect(sentWhen('2026-10-09T14:05:00.000Z', 'America/Chicago', '12h')).toBe('9 October 2026, 9:05 AM');
    expect(sentWhen('2026-10-09T23:30:00.000Z', 'Asia/Kolkata', '24h')).toBe('10 October 2026, 05:00');
    expect(sentWhen('2026-10-09T05:00:00.000Z', 'America/Chicago', '24h')).toBe('9 October 2026, 00:00');
    expect(sentWhen('not a time', 'Asia/Kolkata', '24h')).toBe('');
  });
  it('to how many', () => {
    expect(sentToWords(1)).toBe('Sent to 1 person');
    expect(sentToWords(2)).toBe('Sent to 2 people');
    expect(sentToWords(1200)).toBe('Sent to 1,200 people');
  });
});

describe('the Sent messages page', () => {
  it("the worst thing: it asks for the gym in the address and no other, and shows that gym's messages as sent", async () => {
    orgService.getSentMessages.mockResolvedValue(
      answer([
        message(2, { body: 'Zed, your locker key is at the desk.\n\nAsk for Sam.', people: 1 }),
        message(1, { body: 'Closed on Monday.', sentByName: null, people: 1200, sentAt: '2026-10-08T14:05:00.000Z' }),
      ]),
    );
    draw();
    const list = await rows();
    expect(orgService.getSentMessages.mock.calls).toEqual([[GYM, null]]);
    expect(list).toHaveLength(2);
    // The words as typed, line breaks kept.
    expect(within(list[0]).getByTestId('sent-message-words').textContent).toBe('Zed, your locker key is at the desk.\n\nAsk for Sam.');
    expect(within(list[0]).getByTestId('sent-message-facts').textContent).toBe('Sent to 1 person·9 October 2026, 12:05 PM·Sent by Jordan Hayes');
    expect(within(list[1]).getByTestId('sent-message-facts').textContent).toBe('Sent to 1,200 people·8 October 2026, 9:05 AM·Sent by someone no longer here');
    // How long it is kept is said on the page.
    expect(screen.getByText((text) => text.includes(GYM_SENT_MESSAGES_KEPT_WORDS))).toBeTruthy();
    expect(screen.queryByText('Load more')).toBeNull();
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('href')).toBe('/console/iron-house/members');
  });

  it('the other gym in the address asks for the other gym', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([message(1)]));
    draw('oak-studio');
    await rows();
    expect(orgService.getSentMessages.mock.calls).toEqual([[OTHER, null]]);
  });

  it('staff who may not send a message are told, and nothing is asked for them', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [gymRow({ staffRole: 'trainer', privileges: ['members.read'] })] } });
    draw();
    const told = await screen.findByTestId('sent-messages-not-allowed');
    expect(told.textContent).toContain("Your role doesn't allow you to see sent messages. Ask the owner if you need to.");
    expect(within(told).getByRole('link', { name: 'Back to members' }).getAttribute('href')).toBe('/console/iron-house/members');
    await new Promise((done) => setTimeout(done, 20));
    expect(orgService.getSentMessages).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sent-message')).toBeNull();
    expect(screen.queryByTestId('sent-messages-none')).toBeNull();
  });

  it('a gym that has sent nothing reads how to send one, with a button to the list', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([]));
    draw();
    const none = await screen.findByTestId('sent-messages-none');
    expect(none.textContent).toContain("You haven't sent a message yet");
    expect(none.textContent).toContain('To send one, tick the members you want on your list, then press Send message.');
    fireEvent.click(within(none).getByRole('link', { name: 'Go to members' }));
    expect(await screen.findByText('the members page')).toBeTruthy();
  });

  it("a studio reads its own word", async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [gymRow({ orgType: 'studio' })] } });
    orgService.getSentMessages.mockResolvedValue(answer([]));
    draw();
    const none = await screen.findByTestId('sent-messages-none');
    expect(none.textContent).toContain('tick the clients you want');
    expect(within(none).getByRole('link', { name: 'Go to clients' })).toBeTruthy();
  });

  it('Load more asks after the last message shown, adds the next page, and never draws a message twice', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => message(40 - i));
    orgService.getSentMessages.mockResolvedValueOnce(answer(firstPage, id(21))).mockResolvedValueOnce(answer([message(21), message(20), message(19)]));
    draw();
    expect(await rows()).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByTestId('sent-message')).toHaveLength(22));
    expect(orgService.getSentMessages.mock.calls).toEqual([
      [GYM, null],
      [GYM, id(21)],
    ]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('a list that could not be read says so, never "you haven\'t sent a message", and Try again reads it again', async () => {
    orgService.getSentMessages.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockResolvedValueOnce(answer([message(1)]));
    draw();
    expect(await screen.findByText("We couldn't load your sent messages.")).toBeTruthy();
    expect(screen.queryByTestId('sent-messages-none')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await rows()).toHaveLength(1);
  });

  it('a second page that could not be read keeps the first and says so', async () => {
    orgService.getSentMessages.mockResolvedValueOnce(answer([message(2)], id(2))).mockRejectedValueOnce({ response: { status: 500, data: {} } });
    draw();
    await rows();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText("We couldn't load more.")).toBeTruthy();
    expect(screen.getAllByTestId('sent-message')).toHaveLength(1);
  });
});
