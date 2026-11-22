// V2b-i: Add member and Edit open from the right (spec Part 3 §17.11, "Where a box opens").
//
// THE WORST THING THIS JOB COULD DO: the panel saves into a different member from the one
// whose name it shows, or closing it throws away typed details without asking. So the first
// tests: the panel names the person whose page it opened from and Save sends their record and
// no other, also after the page has moved to a second person; and every way out (the X, Cancel,
// Escape) asks first while something typed is not saved, keeps it on "Keep editing", and
// sends nothing on "Close without saving".
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntryDetailSchema, memberListViewSchema } from '@app/shared';

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
      addMemberListEntry: vi.fn(),
      matchLead: vi.fn(),
      getNextMemberNumber: vi.fn(),
      changeMemberListEntry: vi.fn(),
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
const ada = person(ADA, 'Ada Lovelace', { phone: '+447700900123' });
const bea = person(BEA, 'Bea Hart');
const entryAnswer = (p) => ({ data: { entry: p } });
const written = (outcome, p) => ({ data: { outcome, entry: p, version: 4 } });
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

let onClose;
function openPage(entryId) {
  return render(<MemberListPerson gymId={GYM} entryId={entryId} list={LIST} words={WORDS} readOnly={false} canRemove onClose={onClose} onChanged={vi.fn()} />);
}
const page = () => within(screen.getByTestId('member-person'));
const panel = () => within(screen.getByTestId('person-form-panel'));

beforeEach(() => {
  vi.resetAllMocks();
  onClose = vi.fn();
  orgService.matchLead.mockResolvedValue({ data: { lead: null } });
  orgService.getNextMemberNumber.mockResolvedValue({ data: { memberNumber: '7' } });
  orgService.getMemberListEntry.mockImplementation((_gym, id) => Promise.resolve(entryAnswer({ [ADA]: ada, [BEA]: bea }[id])));
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

describe('the worst thing: the panel saves somebody else, or loses what was typed', () => {
  it("names the person whose page it opened from, shows their details, and saves their record only", async () => {
    orgService.changeMemberListEntry.mockResolvedValue(written('changed', { ...ada, phone: '+447700900555' }));
    openPage(ADA);
    fireEvent.click(await page().findByRole('button', { name: 'Edit' }));
    const edit = screen.getByRole('dialog', { name: 'Edit Ada Lovelace' });
    expect(within(edit).getByText('Nothing changes until you press Save.')).toBeTruthy();
    expect(within(edit).getByLabelText('Email').value).toBe('ada@members.example');
    // Their page stays behind the panel, with their name on it.
    expect(page().getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy();
    fireEvent.change(within(edit).getByLabelText('Phone'), { target: { value: '+447700900555' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.changeMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.changeMemberListEntry).toHaveBeenCalledWith(GYM, ADA, { phone: '+447700900555' });
    // Saved: the panel closes and the page says so.
    await waitFor(() => expect(screen.queryByTestId('person-form-panel')).toBeNull());
    expect(page().getByRole('status').textContent).toMatch(/saved|changed/i);
  });

  it('after the page moves to a second person, Edit is about that person and saves only them', async () => {
    orgService.changeMemberListEntry
      .mockRejectedValueOnce(refusal(409, { error: 'already_on_list', message: 'This person is already on your list.', entryId: BEA }))
      .mockResolvedValueOnce(written('changed', { ...bea, phone: '+447700900777' }));
    openPage(ADA);
    fireEvent.click(await page().findByRole('button', { name: 'Edit' }));
    fireEvent.change(panel().getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.click(panel().getByRole('button', { name: 'Save' }));
    // The refusal is said inside the panel, where the form is, never behind it.
    fireEvent.click(await panel().findByRole('button', { name: 'Open that record' }));
    expect(await page().findByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
    expect(screen.queryByTestId('person-form-panel')).toBeNull();

    fireEvent.click(page().getByRole('button', { name: 'Edit' }));
    const edit = screen.getByRole('dialog', { name: 'Edit Bea Hart' });
    expect(within(edit).queryByDisplayValue('ada@members.example')).toBeNull();
    expect(within(edit).queryByDisplayValue('+447700900123')).toBeNull();
    fireEvent.change(within(edit).getByLabelText('Phone'), { target: { value: '+447700900777' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.changeMemberListEntry).toHaveBeenCalledTimes(2));
    expect(orgService.changeMemberListEntry).toHaveBeenLastCalledWith(GYM, BEA, { phone: '+447700900777' });
  });

  it.each([
    ['the X', () => fireEvent.click(panel().getByRole('button', { name: 'Close' }))],
    ['Cancel', () => fireEvent.click(panel().getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ])('%s asks first while a change is not saved, keeps it, and sends nothing', async (_way, leave) => {
    openPage(ADA);
    fireEvent.click(await page().findByRole('button', { name: 'Edit' }));
    fireEvent.change(panel().getByLabelText('Phone'), { target: { value: '+447700900999' } });
    expect(panel().getByText("You have changes that aren't saved.")).toBeTruthy();

    leave();
    expect(panel().getByText("Your changes aren't saved. Close and lose them?")).toBeTruthy();
    fireEvent.click(panel().getByRole('button', { name: 'Keep editing' }));
    expect(panel().getByLabelText('Phone').value).toBe('+447700900999');

    leave();
    fireEvent.click(panel().getByRole('button', { name: 'Close without saving' }));
    expect(screen.queryByTestId('person-form-panel')).toBeNull();
    expect(page().getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy();
    expect(orgService.changeMemberListEntry).not.toHaveBeenCalled();
    // Edit again starts from what is saved, never from what was thrown away.
    fireEvent.click(page().getByRole('button', { name: 'Edit' }));
    expect(panel().getByLabelText('Phone').value).toBe('+447700900123');
  });

  it('closes straight away when nothing has changed', async () => {
    openPage(ADA);
    fireEvent.click(await page().findByRole('button', { name: 'Edit' }));
    expect(panel().queryByText("You have changes that aren't saved.")).toBeNull();
    fireEvent.click(panel().getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('person-form-panel')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Add member from the right', () => {
  it('is a panel of its own, with Add member, Add and invite and Cancel at its foot', async () => {
    orgService.addMemberListEntry.mockResolvedValue(written('added', person(BEA, 'Bea Hart')));
    openPage(null);
    const add = await screen.findByRole('dialog', { name: 'Add member' });
    expect(within(add).getByText('Nobody is added until you press Add member.')).toBeTruthy();
    // No person's page is drawn behind it: it opens over the page Add member was pressed on.
    expect(screen.queryByTestId('member-person')).toBeNull();
    expect(within(add).getByRole('button', { name: 'Add and invite' })).toBeTruthy();
    fireEvent.change(within(add).getByLabelText('Name'), { target: { value: 'Bea Hart' } });
    fireEvent.change(within(add).getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.addMemberListEntry.mock.calls[0][1]).toMatchObject({ fullName: 'Bea Hart', email: 'bea@members.example' });
    expect(orgService.addMemberListEntry.mock.calls[0][1].invite).toBeUndefined();
    // Added: their page opens, and the panel has gone.
    expect(await page().findByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
    expect(screen.queryByTestId('person-form-panel')).toBeNull();
  });

  it('Add and invite sends both together', async () => {
    orgService.addMemberListEntry.mockResolvedValue(written('added', person(BEA, 'Bea Hart')));
    openPage(null);
    const add = await screen.findByRole('dialog', { name: 'Add member' });
    fireEvent.change(within(add).getByLabelText('Name'), { target: { value: 'Bea Hart' } });
    fireEvent.change(within(add).getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add and invite' }));
    await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.addMemberListEntry.mock.calls[0][1]).toMatchObject({ fullName: 'Bea Hart', invite: true });
  });

  it('Cancel with a name typed asks first; with nothing typed it closes at once', async () => {
    openPage(null);
    await screen.findByRole('dialog', { name: 'Add member' });
    // The next member number filled in is not something staff typed.
    await waitFor(() => expect(panel().getByLabelText(/Member number/).value).toBe('7'));
    fireEvent.click(panel().getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    cleanup();
    openPage(null);
    await screen.findByRole('dialog', { name: 'Add member' });
    fireEvent.change(panel().getByLabelText('Name'), { target: { value: 'Cy Young' } });
    fireEvent.click(panel().getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(panel().getByRole('button', { name: 'Keep editing' }));
    expect(panel().getByLabelText('Name').value).toBe('Cy Young');
    fireEvent.click(panel().getByRole('button', { name: 'Cancel' }));
    fireEvent.click(panel().getByRole('button', { name: 'Close without saving' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(orgService.addMemberListEntry).not.toHaveBeenCalled();
  });
});
