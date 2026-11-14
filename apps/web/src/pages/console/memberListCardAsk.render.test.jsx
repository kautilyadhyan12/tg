// Ask to add card (ROADMAP 18d-vii): the Filter's No card on file, the bar's Ask to add card and its
// box. The worst thing, first: the press carrying anybody the box did not name, or anything going
// before the box has said who will be asked and who won't.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { CARD_REQUEST_WORDS, cardRequestDoneResponseSchema, cardRequestPreviewSchema, memberListEntriesPageSchema, memberListViewSchema } from '@app/shared';

vi.mock('./MemberMemberships', () => ({ default: () => null }));
vi.mock('./MemberNotes', () => ({ default: () => null }));
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
      previewCardRequest: vi.fn(),
      sendCardRequest: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListPanel = (await import('./MemberListPanel')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', it: 'gym' };
const GYM_ROW = { id: GYM, name: 'Iron House Gym', slug: 'iron-house', timezone: 'Europe/London' };

const viewOf = (noCard) =>
  memberListViewSchema.parse({
    hasList: true,
    version: 3,
    lastConfirmedAt: '2026-09-20T10:00:00.000Z',
    counts: { entries: 3, inApp: 2, canBeInvited: 1, noEmail: 0, former: 0 },
    statuses: [{ label: 'Active', count: 3, inApp: 2, canBeInvited: 1 }],
    membershipTypes: [],
    paymentStatuses: [],
    fields: [],
    appWords: [{ word: 'in_app', count: 2 }],
    noCard,
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
    inApp: true,
    invitation: null,
    app: { word: 'in_app', tone: 'green', at: null, line: 'In the app', lineTone: 'plain' },
  };
};
const pageOf = (entries) => ({ data: { page: memberListEntriesPageSchema.parse({ total: entries.length, entries, cursor: null }) } });
const person = (one, more = {}) => ({ entryId: one.entryId, name: one.fullName, ...more });
const boxOf = (over) => ({ data: { preview: cardRequestPreviewSchema.parse({ askCount: over.ask.length, kept: [], askDigest: 'box-1', ...over }) } });
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

let maya;
let sam;
let ben;

const draw = () => render(<MemberListPanel gymId={GYM} gym={GYM_ROW} words={WORDS} readOnly={false} refreshKey={0} />);
const tickOf = (name) => screen.getByRole('checkbox', { name: `Select ${name}` });
const bar = () => within(screen.getByTestId('sel-bar'));
const open = async (preview) => {
  orgService.previewCardRequest.mockResolvedValue(preview);
  draw();
  await screen.findByText('Ben Okafor');
  fireEvent.click(tickOf('Maya Fernandes'));
  fireEvent.click(tickOf('Sam Lee'));
  fireEvent.click(bar().getByTestId('bar-card-ask'));
  return within(await screen.findByTestId('card-ask-box'));
};

beforeEach(() => {
  vi.resetAllMocks();
  maya = entry('Maya Fernandes');
  sam = entry('Sam Lee');
  ben = entry('Ben Okafor');
  orgService.getMemberList.mockResolvedValue({ data: { list: viewOf(2) } });
  orgService.getMemberListEntries.mockResolvedValue(pageOf([maya, sam, ben]));
  orgService.getInvitePreview.mockRejectedValue(new Error('not asked here'));
  orgService.getGymTags.mockResolvedValue({ data: { tags: [] } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Ask to add card, for the people selected', () => {
  it('names who will be asked and who won’t before anything is sent, and the press carries only the ticked and the box’s own count', async () => {
    const box = await open(boxOf({ selected: 2, ask: [person(maya)], kept: [{ reason: 'paid_by', count: 1, people: [person(sam, { payerName: 'Pat Lee' })] }] }));
    expect(orgService.previewCardRequest).toHaveBeenCalledWith(GYM, { kind: 'ticked', entryIds: [maya.entryId, sam.entryId] });
    expect(orgService.sendCardRequest).not.toHaveBeenCalled();
    expect(box.getByText('1 person will be asked to add a card')).toBeTruthy();
    expect(within(box.getByTestId('card-ask-names')).getByText('Maya Fernandes')).toBeTruthy();
    expect(box.getByText("1 person won't be asked")).toBeTruthy();
    expect(box.getByText('1 · Someone else on your list pays for them. Ask the person who pays instead.')).toBeTruthy();
    expect(box.getByText('Sam Lee · paid for by Pat Lee')).toBeTruthy();

    orgService.sendCardRequest.mockResolvedValue({ data: cardRequestDoneResponseSchema.parse({ done: { asked: 1, kept: [{ reason: 'paid_by', count: 1 }] } }) });
    fireEvent.click(box.getByTestId('card-ask-press'));
    expect(await box.findByTestId('card-ask-done')).toBeTruthy();
    expect(box.getByTestId('card-ask-done').textContent).toBe("Asked 1 person to add a card. They'll see it in their inbox in the app. 1 weren't asked.");
    const [gymId, body] = orgService.sendCardRequest.mock.calls[0];
    expect(gymId).toBe(GYM);
    expect(body).toMatchObject({ selection: { kind: 'ticked', entryIds: [maya.entryId, sam.entryId] }, askCount: 1, askDigest: 'box-1' });
    expect(body.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('nobody to ask: no Ask button, only Cancel, and a not-in-app group offers the invite', async () => {
    const box = await open(boxOf({ selected: 2, ask: [], kept: [{ reason: 'not_in_app', count: 2, people: [person(maya), person(sam)] }] }));
    expect(box.getByTestId('card-ask-nobody').textContent).toBe('Nobody you selected can be asked to add a card.');
    expect(box.queryByTestId('card-ask-press')).toBeNull();
    fireEvent.click(box.getByTestId('card-ask-invite'));
    await waitFor(() => expect(screen.getByTestId('invite-stub')).toBeTruthy());
  });

  it('the people changed while it was open: nobody was asked, and the box shows them as they now stand', async () => {
    const box = await open(boxOf({ selected: 2, ask: [person(maya), person(sam)] }));
    const now = cardRequestPreviewSchema.parse({ selected: 2, askCount: 1, ask: [person(maya)], kept: [{ reason: 'asked_recently', count: 1, people: [person(sam, { askedOn: '2025-11-12' })] }], askDigest: 'box-2' });
    orgService.sendCardRequest.mockRejectedValue(refusal(409, { error: 'card_request_people_changed', message: CARD_REQUEST_WORDS.people_changed, preview: now }));
    fireEvent.click(box.getByTestId('card-ask-press'));
    expect(await box.findByText(CARD_REQUEST_WORDS.people_changed)).toBeTruthy();
    expect(box.getByText('Sam Lee · asked 12 Nov 2025')).toBeTruthy();
    expect(box.getByTestId('card-ask-press').textContent).toBe('Ask 1 person');
    expect(box.queryByTestId('card-ask-done')).toBeNull();
  });

  it('a gym that takes no cards in the app, or staff who do not record payments, see neither the Filter choice nor the button', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: viewOf(null) } });
    draw();
    await screen.findByText('Ben Okafor');
    fireEvent.click(tickOf('Maya Fernandes'));
    expect(bar().queryByTestId('bar-card-ask')).toBeNull();
    expect(screen.queryByText('No card on file')).toBeNull();
  });
});
