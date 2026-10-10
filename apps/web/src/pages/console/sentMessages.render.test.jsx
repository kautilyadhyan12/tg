// Sent messages (ROADMAP 20f-ii; spec Part 3 §16.8): the list of what a gym sent to groups,
// and who each went to.
//
// The worst thing on this screen is one gym's messages, whose words can name a member, or
// the names of who got one, shown where they should not be: the page asks only for the gym
// in its address, asks for the names of only the message pressed, and asks nothing at all
// for staff who may not send a message.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GYM_GROUP_MESSAGE_WORDS, GYM_SENT_MESSAGES_KEPT_WORDS, gymSentMessagePeopleResponseSchema, gymSentMessagesResponseSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getMine: vi.fn(), getSentMessages: vi.fn(), getSentMessagePeople: vi.fn(), getMemberList: vi.fn() } };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));
// A person's page has its own tests; here only which record it is opened for.
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, onClose }) => (
    <div data-testid="person-page">
      {entryId}
      <button type="button" onClick={onClose}>
        Close person
      </button>
    </div>
  ),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const MembersSentMessages = (await import('./MembersSentMessages')).default;
const { initialsOf, sentByDay, sentGoneWords, sentTime, sentToWords, sentTodayWords, sentWhen } = await import('./memberListPeople');

const GYM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const ADA = 'a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEN = 'b1b1b1b1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

const message = (n, more = {}) => ({ id: id(n), body: `Notice ${String(n)}`, sentByName: 'Jordan Hayes', sentAt: '2026-03-09T17:05:00.000Z', people: 12, ...more });
const answer = (messages, next = null, leftToday = 3) => ({ data: gymSentMessagesResponseSchema.parse({ page: { messages, next, leftToday } }) });
const names = (people, named = people.length, gone = 0) => ({ data: gymSentMessagePeopleResponseSchema.parse({ sentTo: { people, named, gone } }) });
const failed = () => ({ response: { status: 500, data: {} } });

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
const peopleButton = (row) => within(row).getByTestId('sent-message-people');
const box = () => within(screen.getByTestId('sent-to-box'));

beforeEach(() => {
  vi.resetAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [gymRow(), otherRow] } });
  orgService.getMemberList.mockRejectedValue(failed());
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
    expect(sentTime('2026-10-09T17:05:00.000Z', 'America/Chicago', '12h')).toBe('12:05 PM');
    expect(sentTime('2026-10-09T23:30:00.000Z', 'Asia/Kolkata', '24h')).toBe('05:00');
    expect(sentTime('not a time', 'Asia/Kolkata', '24h')).toBe('');
  });

  it("the day headings follow the gym's calendar, not the computer's", () => {
    // Now: 03:00 UTC on 10 October, which is still the 9th in Chicago and already 08:30 on the 10th in Kolkata.
    const now = new Date('2026-10-10T03:00:00.000Z');
    const sent = [
      message(5, { sentAt: '2026-10-10T01:00:00.000Z' }),
      message(4, { sentAt: '2026-10-09T15:00:00.000Z' }),
      message(3, { sentAt: '2026-10-08T15:00:00.000Z' }),
      message(2, { sentAt: '2026-10-08T14:00:00.000Z' }),
      message(1, { sentAt: '2025-12-31T15:00:00.000Z' }),
    ];
    const shape = (zone) => sentByDay(sent, zone, now).map((day) => [day.heading, day.messages.map((m) => m.body)]);
    expect(shape('America/Chicago')).toEqual([
      ['Today', ['Notice 5', 'Notice 4']],
      ['Yesterday', ['Notice 3', 'Notice 2']],
      ['31 December 2025', ['Notice 1']],
    ]);
    expect(shape('Asia/Kolkata')).toEqual([
      ['Today', ['Notice 5']],
      ['Yesterday', ['Notice 4']],
      ['8 October', ['Notice 3', 'Notice 2']],
      ['31 December 2025', ['Notice 1']],
    ]);
    expect(sentByDay([], 'Asia/Kolkata', now)).toEqual([]);
  });

  it('to how many, whose initials, how many are left today, and who cannot be named', () => {
    expect(sentToWords(1)).toBe('Sent to 1 person');
    expect(sentToWords(1200)).toBe('Sent to 1,200 people');
    expect([initialsOf('Nora Owner'), initialsOf('nora'), initialsOf('Ana María de la Cruz'), initialsOf('  '), initialsOf(null)]).toEqual(['NO', 'NO', 'AC', '', '']);
    expect(sentTodayWords(3)).toBe('You can send 3 more messages to groups today. To send one, tick the members you want on your list, then press Send message.');
    expect(sentTodayWords(1, 'clients')).toBe('You can send 1 more message to a group today. To send one, tick the clients you want on your list, then press Send message.');
    expect(sentTodayWords(0)).toBe(GYM_GROUP_MESSAGE_WORDS.day_full);
    expect(sentGoneWords(1)).toBe("1 more person got it and has since deleted their account, so we can't name them.");
    expect(sentGoneWords(2)).toBe("2 more people got it and have since deleted their accounts, so we can't name them.");
  });
});

describe('the Sent messages page', () => {
  it("the worst thing: it asks for the gym in the address and no other, shows that gym's messages as sent, and asks for no names until a message is pressed", async () => {
    orgService.getSentMessages.mockResolvedValue(
      answer(
        [
          message(2, { body: 'Zed, your locker key is at the desk.\n\nAsk for Sam.', people: 1 }),
          message(1, { body: 'Closed on Monday.', sentByName: null, people: 1200, sentAt: '2026-03-08T14:05:00.000Z' }),
        ],
        null,
        2,
      ),
    );
    draw();
    const list = await rows();
    expect(orgService.getSentMessages.mock.calls).toEqual([[GYM, null]]);
    expect(orgService.getSentMessagePeople).not.toHaveBeenCalled();
    expect(list).toHaveLength(2);
    // The words as typed, line breaks kept; who sent it and when; to how many.
    expect(within(list[0]).getByTestId('sent-message-words').textContent).toBe('Zed, your locker key is at the desk.\n\nAsk for Sam.');
    expect(within(list[0]).getByTestId('sent-message-by').textContent).toBe('Jordan Hayes12:05 PM');
    expect(peopleButton(list[0]).textContent).toBe('Sent to 1 person');
    expect(within(list[1]).getByTestId('sent-message-by').textContent).toBe('Someone no longer here9:05 AM');
    expect(peopleButton(list[1]).textContent).toBe('Sent to 1,200 people');
    // A heading for each day.
    expect(screen.getAllByTestId('sent-day-heading').map((h) => h.textContent)).toEqual(['9 March', '8 March']);
    // How long it is kept, and how many more can go today, with the way to send one.
    expect(screen.getByText((text) => text.includes(GYM_SENT_MESSAGES_KEPT_WORDS))).toBeTruthy();
    expect(screen.getByTestId('sent-today').textContent).toBe(
      'You can send 2 more messages to groups today. To send one, tick the members you want on your list, then press Send message.Go to members',
    );
    expect(screen.getByTestId('sent-send-one').getAttribute('href')).toBe('/console/iron-house/members');
    expect(screen.queryByText('Load more')).toBeNull();
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('href')).toBe('/console/iron-house/members');
  });

  it('Sent to N people opens the names of THAT message, and a name opens that person', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([message(2, { body: 'Second', people: 3 }), message(1, { body: 'First', people: 1 })]));
    orgService.getSentMessagePeople.mockResolvedValue(names([{ entryId: ADA, name: 'Ada Lovelace' }, { entryId: BEN, name: 'Ben Carter' }, { entryId: null, name: 'Una Unlisted' }]));
    draw();
    fireEvent.click(peopleButton((await rows())[0]));
    await box().findByTestId('sent-to-names');
    expect(orgService.getSentMessagePeople.mock.calls).toEqual([[GYM, id(2)]]);
    expect(screen.getByRole('dialog', { name: 'Sent to 3 people' })).toBeTruthy();
    expect(box().getByTestId('sent-to-words').textContent).toBe('Second');
    expect(within(box().getByTestId('sent-to-names')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ada Lovelace', 'Ben Carter', 'Una Unlisted']);
    // Somebody on no record has no page to open.
    expect(box().queryByRole('button', { name: "Open Una Unlisted's page" })).toBeNull();
    expect(box().queryByTestId('sent-to-more')).toBeNull();
    expect(box().queryByTestId('sent-to-gone')).toBeNull();
    fireEvent.click(box().getByRole('button', { name: "Open Ben Carter's page" }));
    expect(screen.getByTestId('person-page').textContent).toContain(BEN);
    expect(screen.queryByTestId('sent-to-box')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close person' }));
    expect(screen.queryByTestId('person-page')).toBeNull();
    // The other message asks for its own names.
    orgService.getSentMessagePeople.mockResolvedValue(names([{ entryId: ADA, name: 'Ada Lovelace' }]));
    fireEvent.click(peopleButton(screen.getAllByTestId('sent-message')[1]));
    await box().findByTestId('sent-to-names');
    expect(orgService.getSentMessagePeople.mock.calls[1]).toEqual([GYM, id(1)]);
    expect(within(box().getByTestId('sent-to-names')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ada Lovelace']);
    fireEvent.click(box().getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('sent-to-box')).toBeNull();
  });

  it('more names than the box holds are counted, and people who deleted their account are counted and not named', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([message(1, { people: 153 })]));
    orgService.getSentMessagePeople.mockResolvedValue(names([{ entryId: ADA, name: 'Ada Lovelace' }], 150, 3));
    draw();
    fireEvent.click(peopleButton((await rows())[0]));
    expect((await box().findByTestId('sent-to-more')).textContent).toBe('and 149 more');
    expect(box().getByTestId('sent-to-gone').textContent).toBe("3 more people got it and have since deleted their accounts, so we can't name them.");
  });

  it('two people now on one record are two lines', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([message(1, { people: 2 })]));
    orgService.getSentMessagePeople.mockResolvedValue(names([{ entryId: ADA, name: 'Ada Lovelace' }, { entryId: ADA, name: 'Ada Lovelace' }]));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    draw();
    fireEvent.click(peopleButton((await rows())[0]));
    await box().findByTestId('sent-to-names');
    expect(within(box().getByTestId('sent-to-names')).getAllByRole('listitem')).toHaveLength(2);
    // React says nothing about two rows with one key.
    expect(errors.mock.calls.filter((call) => String(call[0]).includes('same key'))).toEqual([]);
    errors.mockRestore();
  });

  it('names that could not be read say so, never an empty list, and Try again asks again', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([message(1)]));
    orgService.getSentMessagePeople.mockRejectedValueOnce(failed()).mockResolvedValueOnce(names([{ entryId: ADA, name: 'Ada Lovelace' }]));
    draw();
    fireEvent.click(peopleButton((await rows())[0]));
    expect((await box().findByRole('alert')).textContent).toBe("We couldn't load who it was sent to. Please try again.");
    expect(box().queryByTestId('sent-to-names')).toBeNull();
    fireEvent.click(box().getByRole('button', { name: 'Try again' }));
    expect((await box().findByTestId('sent-to-names')).textContent).toBe('Ada Lovelace');
  });

  it('the other gym in the address asks for the other gym', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([message(1)]));
    orgService.getSentMessagePeople.mockResolvedValue(names([]));
    draw('oak-studio');
    fireEvent.click(peopleButton((await rows())[0]));
    await waitFor(() => expect(orgService.getSentMessagePeople).toHaveBeenCalled());
    expect(orgService.getSentMessages.mock.calls).toEqual([[OTHER, null]]);
    expect(orgService.getSentMessagePeople.mock.calls).toEqual([[OTHER, id(1)]]);
  });

  it('staff who may not send a message are told, and nothing is asked for them', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [gymRow({ staffRole: 'trainer', privileges: ['members.read'] })] } });
    draw();
    const told = await screen.findByTestId('sent-messages-not-allowed');
    expect(told.textContent).toContain("Your role doesn't allow you to see sent messages. Ask the owner if you need to.");
    expect(within(told).getByRole('link', { name: 'Back to members' }).getAttribute('href')).toBe('/console/iron-house/members');
    await new Promise((done) => setTimeout(done, 20));
    expect(orgService.getSentMessages).not.toHaveBeenCalled();
    expect(orgService.getSentMessagePeople).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sent-message')).toBeNull();
    expect(screen.queryByTestId('sent-messages-none')).toBeNull();
  });

  it('a gym that has sent nothing reads how to send one, with a button to the list', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([]));
    draw();
    const none = await screen.findByTestId('sent-messages-none');
    expect(none.textContent).toContain("You haven't sent a message yet");
    expect(none.textContent).toContain('To send one, tick the members you want on your list, then press Send message.');
    // One way to the list, not two.
    expect(screen.queryByTestId('sent-today')).toBeNull();
    fireEvent.click(within(none).getByRole('link', { name: 'Go to members' }));
    expect(await screen.findByText('the members page')).toBeTruthy();
  });

  it('a studio reads its own word', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [gymRow({ orgType: 'studio' })] } });
    orgService.getSentMessages.mockResolvedValue(answer([]));
    draw();
    const none = await screen.findByTestId('sent-messages-none');
    expect(none.textContent).toContain('tick the clients you want');
    expect(within(none).getByRole('link', { name: 'Go to clients' })).toBeTruthy();
  });

  it('a full day says so with no button to the list, and a gym that can change nothing has neither', async () => {
    orgService.getSentMessages.mockResolvedValue(answer([message(1)], null, 0));
    draw();
    await rows();
    expect(screen.getByTestId('sent-today').textContent).toBe(GYM_GROUP_MESSAGE_WORDS.day_full);
    expect(screen.queryByTestId('sent-send-one')).toBeNull();
    cleanup();
    resetConsoleOrgs();
    orgService.getMine.mockResolvedValue({ data: { orgs: [gymRow({ consoleReadOnly: true })] } });
    orgService.getSentMessages.mockResolvedValue(answer([message(1)], null, 3));
    draw();
    await rows();
    expect(screen.queryByTestId('sent-today')).toBeNull();
    expect(screen.queryByTestId('sent-send-one')).toBeNull();
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
    // One heading for the day they share.
    expect(screen.getAllByTestId('sent-day-heading')).toHaveLength(1);
  });

  it('a list that could not be read says so, never "you haven\'t sent a message", and Try again reads it again', async () => {
    orgService.getSentMessages.mockRejectedValueOnce(failed()).mockResolvedValueOnce(answer([message(1)]));
    draw();
    expect(await screen.findByText("We couldn't load your sent messages.")).toBeTruthy();
    expect(screen.queryByTestId('sent-messages-none')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await rows()).toHaveLength(1);
  });

  it('a second page that could not be read keeps the first and says so', async () => {
    orgService.getSentMessages.mockResolvedValueOnce(answer([message(2)], id(2))).mockRejectedValueOnce(failed());
    draw();
    await rows();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText("We couldn't load more.")).toBeTruthy();
    expect(screen.getAllByTestId('sent-message')).toHaveLength(1);
  });
});
