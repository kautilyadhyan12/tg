// V2b-iii: the people questions on a member's page open in the middle, over their page (spec Part 3
// §17.11, "Where a box opens").
//
// THE WORST THING THIS JOB COULD DO: a Remove or Delete permanently box names one member and
// removes or deletes another, once the page behind it has moved to a second person. So the first
// tests: the box names the person whose page it opened from and its button sends their record and
// no other, also after a merge has moved the page to the other record; and Escape, pressing outside
// and its own Cancel send nothing.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntriesPageSchema, memberListEntryDetailSchema, memberListViewSchema } from '@app/shared';

vi.mock('./MemberMemberships', () => ({ default: () => null }));
vi.mock('./MemberNotes', () => ({ default: () => null }));
vi.mock('./MemberPayer', () => ({ default: () => null }));
vi.mock('./MemberCard', () => ({ default: () => null }));

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberListEntry: vi.fn(),
      getMemberListEntries: vi.fn(),
      matchLead: vi.fn(),
      getNextMemberNumber: vi.fn(),
      takeOffMemberListEntry: vi.fn(),
      deleteFormerMemberListEntry: vi.fn(),
      mergeMemberListEntries: vi.fn(),
      inviteMemberListEntry: vi.fn(),
      getDeskWaiver: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListPerson = (await import('./MemberListPerson')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', personCap: 'Member', it: 'gym' };
const LIST = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 2, inApp: 0, canBeInvited: 2, noEmail: 0, former: 0 },
  statuses: [{ label: 'Active', count: 2, inApp: 0, canBeInvited: 2 }],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [],
  appWords: [],
});

function person(entryId, fullName, over = {}) {
  return memberListEntryDetailSchema.parse({
    entryId,
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
    extra: [],
    handEdited: [],
    members: [],
    ...over,
  });
}
const ada = person(ADA, 'Ada Lovelace');
const bea = person(BEA, 'Bea Hart');
const PAST = '2026-08-01T10:00:00.000Z';
const row = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !['extra', 'handEdited', 'members'].includes(k)));
const entryAnswer = (p) => ({ data: { entry: p } });
const written = (outcome, p) => ({ data: { outcome, entry: p, version: 4 } });
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

function openPage(entryId) {
  return render(<MemberListPerson gymId={GYM} entryId={entryId} list={LIST} words={WORDS} readOnly={false} canRemove onClose={vi.fn()} onChanged={vi.fn()} />);
}
const page = () => within(screen.getByTestId('member-person'));
const box = () => within(screen.getByTestId('person-ask'));
const pickMore = async (name) => {
  fireEvent.click(await page().findByRole('button', { name: /^More/ }));
  fireEvent.click(await page().findByRole('menuitem', { name: new RegExp(`^${name}`) }));
};

beforeEach(() => {
  vi.resetAllMocks();
  orgService.matchLead.mockResolvedValue({ data: { lead: null } });
  orgService.getNextMemberNumber.mockResolvedValue({ data: { memberNumber: '7' } });
  orgService.getMemberListEntry.mockImplementation((_gym, id) => Promise.resolve(entryAnswer({ [ADA]: ada, [BEA]: bea }[id])));
});

afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = '';
});

describe('the worst thing: the box in the middle acts on somebody else', () => {
  it('Remove names the person whose page it opened from, over their page, and removes only them', async () => {
    orgService.takeOffMemberListEntry.mockResolvedValue(written('taken_off', { ...ada, formerAt: PAST }));
    openPage(ADA);
    await pickMore('Remove');
    const ask = screen.getByRole('alertdialog', { name: 'Remove Ada Lovelace?' });
    expect(ask.getAttribute('aria-modal')).toBe('true');
    // Their page stays behind the box, with their name and their details on it.
    expect(page().getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy();
    expect(within(ask).queryByText(/Bea/)).toBeNull();
    // The keys start on Cancel, never on the red answer.
    expect(document.activeElement.textContent).toBe('Cancel');
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(orgService.takeOffMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.takeOffMemberListEntry).toHaveBeenCalledWith(GYM, ADA);
    await waitFor(() => expect(screen.queryByTestId('person-ask')).toBeNull());
    expect(page().getByRole('status').textContent.length).toBeGreaterThan(0);
  });

  it('after a merge moves the page to the other record, Remove is about that person and removes only them', async () => {
    orgService.getMemberListEntries.mockResolvedValue({ data: { page: memberListEntriesPageSchema.parse({ total: 1, entries: [row(bea)], cursor: null }) } });
    orgService.mergeMemberListEntries.mockResolvedValue(written('merged', bea));
    orgService.takeOffMemberListEntry.mockResolvedValue(written('taken_off', { ...bea, formerAt: PAST }));
    openPage(ADA);
    await pickMore('Merge duplicate');
    expect(screen.getByRole('alertdialog', { name: 'Merge duplicate' })).toBeTruthy();
    expect(page().getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy();
    fireEvent.change(box().getByLabelText('Find the other record'), { target: { value: 'bea' } });
    fireEvent.click(await box().findByRole('button', { name: /bea@members\.example/ }));
    fireEvent.click(await box().findByTestId('keep-second'));
    fireEvent.click(box().getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(orgService.mergeMemberListEntries).toHaveBeenCalledWith(GYM, ADA, BEA, false));
    expect(await page().findByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
    expect(screen.queryByTestId('person-ask')).toBeNull();

    await pickMore('Remove');
    const ask = screen.getByRole('alertdialog', { name: 'Remove Bea Hart?' });
    expect(within(ask).queryByText(/Ada/)).toBeNull();
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(orgService.takeOffMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.takeOffMemberListEntry).toHaveBeenCalledWith(GYM, BEA);
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['pressing outside', () => fireEvent.click(screen.getByTestId('box-outside'))],
    ["Don't delete", () => fireEvent.click(box().getByRole('button', { name: "Don't delete" }))],
  ])('Delete permanently: %s deletes nobody and leaves their page', async (_way, leave) => {
    const past = { ...ada, formerAt: PAST };
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(past));
    openPage(ADA);
    fireEvent.click(await page().findByTestId('delete-press'));
    expect(screen.getByRole('alertdialog', { name: 'Delete Ada Lovelace permanently?' })).toBeTruthy();
    leave();
    expect(screen.queryByTestId('person-ask')).toBeNull();
    expect(page().getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy();
    expect(orgService.deleteFormerMemberListEntry).not.toHaveBeenCalled();
  });

  it("a refusal is said inside the box, and the box still names the same person", async () => {
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer({ ...ada, formerAt: PAST }));
    orgService.deleteFormerMemberListEntry.mockRejectedValue(refusal(409, { error: 'conflict', message: "This record changed. Please try again." }));
    openPage(ADA);
    fireEvent.click(await page().findByTestId('delete-press'));
    fireEvent.click(box().getByRole('button', { name: 'Delete permanently' }));
    expect(await box().findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alertdialog', { name: 'Delete Ada Lovelace permanently?' })).toBeTruthy();
    expect(page().queryByRole('alert')).toBeNull();
    expect(orgService.deleteFormerMemberListEntry).toHaveBeenCalledWith(GYM, ADA);
  });

  it('Invite to app asks in the middle and invites only them', async () => {
    orgService.inviteMemberListEntry.mockResolvedValue({ data: { invite: { outcome: 'sent', invitation: null } } });
    openPage(ADA);
    fireEvent.click(await page().findByRole('button', { name: 'Invite to app' }));
    const ask = screen.getByRole('alertdialog', { name: 'Invite Ada Lovelace to the app?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(orgService.inviteMemberListEntry).toHaveBeenCalledWith(GYM, ADA));
  });
});
