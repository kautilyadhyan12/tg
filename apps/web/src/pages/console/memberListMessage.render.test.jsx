// A message to the people selected (spec Part 3 §16.8; ROADMAP 20f-i): the Send message
// button on Members and its box. The worst thing, first: the press carrying anybody who was
// not ticked, or anything going before the box has named who will get it and who won't.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import {
  GYM_GROUP_MESSAGE_PROBLEM_WORDS,
  GYM_GROUP_MESSAGE_WORDS,
  MEMBER_LIST_SELECTION_CHANGED_WORDS,
  gymGroupMessageDoneResponseSchema,
  gymGroupMessagePreviewSchema,
  memberListEntriesPageSchema,
  memberListViewSchema,
} from '@app/shared';

vi.mock('./MemberMemberships', () => ({ default: () => null }));
vi.mock('./MemberNotes', () => ({ default: () => null }));
// The two places the box can open: what each is opened for is all these tests read.
vi.mock('./MemberListInvite', () => ({ default: ({ selection }) => <div data-testid="invite-stub">{JSON.stringify(selection)}</div> }));
vi.mock('./MemberListPerson', () => ({ default: ({ entryId }) => <div data-testid="person-stub">{entryId}</div> }));

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getInvitePreview: vi.fn(),
      selectAllMembers: vi.fn(),
      getGymTags: vi.fn(),
      previewGroupMessage: vi.fn(),
      sendGroupMessage: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListPanel = (await import('./MemberListPanel')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', it: 'gym' };
const GYM_ROW = { id: GYM, name: 'Iron House Gym', slug: 'iron-house', timezone: 'Europe/London' };

const view = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 3, inApp: 2, canBeInvited: 1, noEmail: 0, former: 1 },
  statuses: [{ label: 'Active', count: 3, inApp: 2, canBeInvited: 1 }],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [],
  appWords: [{ word: 'not_in_app', count: 3 }],
});

let n = 0;
const entry = (fullName) => {
  n += 1;
  return {
    entryId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}@members.example`,
    phone: null,
    memberNumber: null,
    status: 'Active',
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    endsOnKind: null,
    paymentStatus: null,
    dateOfBirth: null,
    formerAt: null,
    source: 'upload',
    inApp: false,
    invitation: null,
    app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
  };
};
const pageOf = (entries, total = entries.length) => ({ data: { page: memberListEntriesPageSchema.parse({ total, entries, cursor: null }) } });
const person = (one) => ({ entryId: one.entryId, name: one.fullName });
const boxOf = (over) => ({ data: { preview: gymGroupMessagePreviewSchema.parse({ sendCount: over.send.length, kept: [], leftToday: 3, ...over }) } });
const doneOf = (done) => ({ data: gymGroupMessageDoneResponseSchema.parse({ done: { kept: [], leftToday: 2, ...done } }) });
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

let ada;
let ben;
let cara;

const draw = (props = {}) => render(<MemberListPanel gymId={GYM} gym={GYM_ROW} words={WORDS} readOnly={false} refreshKey={0} {...props} />);
const tickOf = (name) => screen.getByRole('checkbox', { name: `Select ${name}` });
const bar = () => within(screen.getByTestId('sel-bar'));
const type = (box, words) => fireEvent.change(box.getByLabelText('Your message'), { target: { value: words } });
/** Ticks Ada and Ben and opens the box. */
const open = async (preview) => {
  orgService.previewGroupMessage.mockResolvedValue(preview);
  draw();
  await screen.findByText('Ben Carter');
  fireEvent.click(tickOf('Ada Lovelace'));
  fireEvent.click(tickOf('Ben Carter'));
  fireEvent.click(bar().getByTestId('bar-message'));
  return within(await screen.findByTestId('message-box'));
};

beforeEach(() => {
  vi.resetAllMocks();
  ada = entry('Ada Lovelace');
  ben = entry('Ben Carter');
  cara = entry('Cara Diaz');
  orgService.getMemberList.mockResolvedValue({ data: { list: view } });
  orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben, cara]));
  orgService.getInvitePreview.mockRejectedValue(new Error('not asked here'));
  orgService.getGymTags.mockResolvedValue({ data: { tags: [] } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Send message, for the people selected', () => {
  it('the worst thing: only the people ticked are sent, and nothing goes before the box has named who will get it and who will not', async () => {
    const ticked = { kind: 'ticked', entryIds: [ada.entryId, ben.entryId] };
    const box = await open(boxOf({ selected: 2, send: [person(ada)], kept: [{ reason: 'not_in_app', count: 1, people: [person(ben)] }] }));
    await box.findByTestId('message-send');
    expect(orgService.previewGroupMessage).toHaveBeenCalledTimes(1);
    expect(orgService.previewGroupMessage).toHaveBeenCalledWith(GYM, ticked);
    expect(box.getByTestId('message-send').textContent).toContain('1 person will get this message');
    expect(within(box.getByTestId('message-names-send')).getByText('Ada Lovelace')).toBeTruthy();
    // Who won't, and why.
    expect(within(box.getByTestId('message-kept')).getByText("1 person won't get it")).toBeTruthy();
    expect(box.getByTestId('message-kept-not_in_app').textContent).toContain('1 · Not in the app yet. Messages are read in the app.');
    expect(box.getByTestId('message-invite').textContent).toBe('Invite them to the app');
    expect(within(box.getByTestId('message-names-not_in_app')).getByText('Ben Carter')).toBeTruthy();
    // Cara was never ticked: she is nowhere in the box.
    expect(box.queryByText('Cara Diaz')).toBeNull();
    expect(box.getByTestId('message-today').textContent).toBe('You can send 3 more messages to groups today.');
    // The button says how many, and cannot be pressed with nothing typed.
    const button = box.getByTestId('message-press');
    expect(button.textContent).toBe('Send to 1 person');
    expect(button.disabled).toBe(true);
    expect(orgService.sendGroupMessage).not.toHaveBeenCalled();

    type(box, '  Closed on Monday.  ');
    expect(box.getByTestId('message-count').textContent).toBe('17 of 500');
    orgService.sendGroupMessage.mockResolvedValue(doneOf({ sent: 1, kept: [{ reason: 'not_in_app', count: 1 }] }));
    fireEvent.click(box.getByTestId('message-press'));
    expect((await box.findByTestId('message-done')).textContent).toBe("Message sent to 1 person. 1 didn't get it.");
    expect(orgService.sendGroupMessage).toHaveBeenCalledTimes(1);
    const [gym, sent] = orgService.sendGroupMessage.mock.calls[0];
    expect(gym).toBe(GYM);
    expect(sent).toEqual({ selection: ticked, body: 'Closed on Monday.', sendCount: 1, key: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    fireEvent.click(box.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('message-box')).toBeNull();
  });

  it('every reason somebody is left out has its own line, and the counts are the server’s', async () => {
    const box = await open(
      boxOf({
        selected: 9,
        send: [person(ada)],
        sendCount: 4,
        kept: [
          { reason: 'not_in_app', count: 1, people: [person(ben)] },
          { reason: 'switched_off', count: 1, people: [{ entryId: cara.entryId, name: 'Cy Off' }] },
          { reason: 'shared', count: 1, people: [{ entryId: cara.entryId, name: 'Tam Twin' }] },
          { reason: 'former', count: 1, people: [{ entryId: cara.entryId, name: 'Fay Former' }] },
          { reason: 'gone', count: 1, people: [] },
        ],
      }),
    );
    await box.findByTestId('message-send');
    expect(box.getByTestId('message-send').textContent).toContain('4 people will get this message');
    expect(box.getByTestId('message-send').textContent).toContain('and 3 more');
    expect(within(box.getByTestId('message-kept')).getByText("5 people won't get it")).toBeTruthy();
    expect(box.getByTestId('message-kept-switched_off').textContent).toContain('1 · Switched your messages off in their app.');
    expect(box.getByTestId('message-kept-shared').textContent).toContain("1 · Two app accounts are on this one person's page, so we can't tell whose inbox it is. Open their page to see both.");
    expect(box.getByTestId('message-kept-former').textContent).toContain('1 · No longer a member.');
    expect(box.getByTestId('message-kept-gone').textContent).toBe('1 · No longer on your list.');
    expect(box.getByTestId('message-press').textContent).toBe('Send to 4 people');
  });

  it('nobody who can get it: the box says so and has no words to type and no Send', async () => {
    const box = await open(boxOf({ selected: 2, send: [], kept: [{ reason: 'not_in_app', count: 2, people: [person(ada), person(ben)] }] }));
    expect((await box.findByTestId('message-nobody')).textContent).toBe('Nobody you selected can get a message.');
    expect(box.queryByLabelText('Your message')).toBeNull();
    expect(box.queryByTestId('message-press')).toBeNull();
    expect(box.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('the three for the day are used: the box says so and has no Send', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada), person(ben)], leftToday: 0 }));
    expect((await box.findByTestId('message-today')).textContent).toBe(GYM_GROUP_MESSAGE_WORDS.day_full);
    expect(box.queryByLabelText('Your message')).toBeNull();
    expect(box.queryByTestId('message-press')).toBeNull();
    cleanup();
    const one = await open(boxOf({ selected: 2, send: [person(ada), person(ben)], leftToday: 1 }));
    expect((await one.findByTestId('message-today')).textContent).toBe('You can send 1 more message to a group today.');
  });

  it('words that cannot go are said at once and nothing is sent; too many disable Send', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada), person(ben)] }));
    await box.findByTestId('message-send');
    type(box, 'Book at www.ironhouse.com');
    fireEvent.click(box.getByTestId('message-press'));
    expect(box.getByRole('alert').textContent).toBe(GYM_GROUP_MESSAGE_PROBLEM_WORDS.link);
    type(box, 'Follow @ironhouse');
    // Typing again takes the old line away.
    expect(box.queryByRole('alert')).toBeNull();
    fireEvent.click(box.getByTestId('message-press'));
    expect(box.getByRole('alert').textContent).toBe(GYM_GROUP_MESSAGE_PROBLEM_WORDS.at);
    type(box, 'z'.repeat(501));
    expect(box.getByTestId('message-count').textContent).toBe('501 of 500');
    expect(box.getByTestId('message-press').disabled).toBe(true);
    type(box, '   \n  ');
    expect(box.getByTestId('message-press').disabled).toBe(true);
    expect(orgService.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('the refusal the server makes is shown in its words, the typed message is kept, and the same box sends with the same key', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada), person(ben)] }));
    await box.findByTestId('message-send');
    type(box, 'Wipe the bench, dumbass.');
    orgService.sendGroupMessage.mockRejectedValueOnce(refusal(400, { error: 'group_message_bad_words', message: GYM_GROUP_MESSAGE_WORDS.bad_words(['dumbass']) }));
    fireEvent.click(box.getByTestId('message-press'));
    expect((await box.findByRole('alert')).textContent).toBe("We can't send a message with this word in it: dumbass. Take it out and try again.");
    expect(box.getByLabelText('Your message').value).toBe('Wipe the bench, dumbass.');
    type(box, 'Please wipe the bench.');
    orgService.sendGroupMessage.mockResolvedValueOnce(doneOf({ sent: 2 }));
    fireEvent.click(box.getByTestId('message-press'));
    expect((await box.findByTestId('message-done')).textContent).toBe('Message sent to 2 people.');
    const keys = orgService.sendGroupMessage.mock.calls.map((call) => call[1].key);
    expect(keys[0]).toBe(keys[1]);
  });

  it('the people changed while staff typed: nothing was sent, the box names them again, and the next press carries the new number', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada), person(ben)] }));
    await box.findByTestId('message-send');
    type(box, 'The Saturday class is full.');
    const now = gymGroupMessagePreviewSchema.parse({ selected: 2, sendCount: 1, send: [person(ada)], kept: [{ reason: 'switched_off', count: 1, people: [person(ben)] }], leftToday: 3 });
    orgService.sendGroupMessage.mockRejectedValueOnce(refusal(409, { error: 'group_message_people_changed', message: GYM_GROUP_MESSAGE_WORDS.people_changed, preview: now }));
    fireEvent.click(box.getByTestId('message-press'));
    expect((await box.findByRole('alert')).textContent).toBe(GYM_GROUP_MESSAGE_WORDS.people_changed);
    expect(box.getByTestId('message-press').textContent).toBe('Send to 1 person');
    expect(within(box.getByTestId('message-names-switched_off')).getByText('Ben Carter')).toBeTruthy();
    expect(box.getByLabelText('Your message').value).toBe('The Saturday class is full.');
    orgService.sendGroupMessage.mockResolvedValueOnce(doneOf({ sent: 1, kept: [{ reason: 'switched_off', count: 1 }] }));
    fireEvent.click(box.getByTestId('message-press'));
    await box.findByTestId('message-done');
    expect(orgService.sendGroupMessage.mock.calls.map((call) => call[1].sendCount)).toEqual([2, 1]);
  });

  it('a press while one is being sent sends nothing more', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada), person(ben)] }));
    await box.findByTestId('message-send');
    type(box, 'Hello.');
    let answer;
    orgService.sendGroupMessage.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    fireEvent.click(box.getByTestId('message-press'));
    fireEvent.click(box.getByTestId('message-press'));
    expect(box.getByTestId('message-press').disabled).toBe(true);
    answer(doneOf({ sent: 2 }));
    await box.findByTestId('message-done');
    expect(orgService.sendGroupMessage).toHaveBeenCalledTimes(1);
  });

  it('a Select all that moved: the box shuts, nothing is sent, and the list says why', async () => {
    orgService.previewGroupMessage.mockRejectedValue(refusal(409, { error: 'selection_changed', message: MEMBER_LIST_SELECTION_CHANGED_WORDS, count: 4, digest: 'a'.repeat(64) }));
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    fireEvent.click(bar().getByTestId('bar-message'));
    await waitFor(() => expect(screen.queryByTestId('message-box')).toBeNull());
    expect(orgService.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('the box that cannot be read says so and sends nothing', async () => {
    orgService.previewGroupMessage.mockRejectedValue(refusal(500, {}));
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    fireEvent.click(bar().getByTestId('bar-message'));
    const box = within(await screen.findByTestId('message-box'));
    expect((await box.findByRole('alert')).textContent).toBe("We couldn't work out who would get it. Please try again.");
    expect(box.queryByTestId('message-press')).toBeNull();
  });

  it('a gym that can change nothing has no Send message button', async () => {
    draw({ readOnly: true });
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    expect(bar().queryByTestId('bar-message')).toBeNull();
    expect(bar().getByTestId('bar-download')).toBeTruthy();
  });
});

// What round one's review found (2026-10-10).
describe('Send message, after the review', () => {
  it('"Invite them to the app" shuts this box and opens Invite for the same people', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada)], kept: [{ reason: 'not_in_app', count: 1, people: [person(ben)] }] }));
    fireEvent.click(await box.findByTestId('message-invite'));
    expect(screen.queryByTestId('message-box')).toBeNull();
    expect(screen.getByTestId('invite-stub').textContent).toBe(JSON.stringify({ kind: 'ticked', entryIds: [ada.entryId, ben.entryId] }));
    expect(orgService.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('a name on a page two accounts share opens that page, and the box shuts', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada)], kept: [{ reason: 'shared', count: 1, people: [person(ben)] }] }));
    await box.findByTestId('message-send');
    expect(box.queryByTestId('message-invite')).toBeNull();
    fireEvent.click(box.getByRole('button', { name: "Open Ben Carter's page" }));
    expect(screen.queryByTestId('message-box')).toBeNull();
    expect(screen.getByTestId('person-stub').textContent).toBe(ben.entryId);
  });

  it('an emoji counts as one character, and 500 of them can be sent', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada), person(ben)] }));
    await box.findByTestId('message-send');
    const arm = String.fromCodePoint(0x1f4aa);
    type(box, arm.repeat(500));
    expect(box.getByTestId('message-count').textContent).toBe('500 of 500');
    expect(box.getByTestId('message-press').disabled).toBe(false);
    type(box, arm.repeat(501));
    expect(box.getByTestId('message-count').textContent).toBe('501 of 500');
    expect(box.getByTestId('message-press').disabled).toBe(true);
  });

  it('told the earlier message went and this one did not, the next press is a new message with a new key', async () => {
    const box = await open(boxOf({ selected: 2, send: [person(ada), person(ben)] }));
    await box.findByTestId('message-send');
    type(box, 'Bring two towels.');
    orgService.sendGroupMessage.mockRejectedValueOnce(refusal(409, { error: 'group_message_earlier_sent', message: GYM_GROUP_MESSAGE_WORDS.earlier_sent(2) }));
    fireEvent.click(box.getByTestId('message-press'));
    expect((await box.findByRole('alert')).textContent).toBe('Your earlier message was already sent to 2 people. This one was not sent. Press Send again to send it as well.');
    expect(box.queryByTestId('message-done')).toBeNull();
    orgService.sendGroupMessage.mockResolvedValueOnce(doneOf({ sent: 2 }));
    fireEvent.click(box.getByTestId('message-press'));
    await box.findByTestId('message-done');
    const keys = orgService.sendGroupMessage.mock.calls.map((call) => call[1].key);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
