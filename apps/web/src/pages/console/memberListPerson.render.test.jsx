// One person on the gym's own list (ROADMAP 5b-i): their page, Change, Take off, Put
// back, Delete for good and Join.
//
// THE WORST THING THIS SCREEN COULD DO: staff tap one person and the page shows,
// changes or deletes somebody else's record — an answer for somebody tapped a moment
// earlier landing under the wrong name, or Join keeping the record staff meant to
// remove. So the first tests: a late answer for another person is never shown and a
// save goes to the person on screen; the server answering for a different record is
// refused; and Join removes exactly the record shown under "Remove".
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntryDetailSchema, memberListEntriesPageSchema, memberListViewSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getMemberListEntry: vi.fn(),
      addMemberListEntry: vi.fn(),
      changeMemberListEntry: vi.fn(),
      takeOffMemberListEntry: vi.fn(),
      restoreMemberListEntry: vi.fn(),
      mergeMemberListEntries: vi.fn(),
      deleteFormerMemberListEntry: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListPerson = (await import('./MemberListPerson')).default;
const MemberListPanel = (await import('./MemberListPanel')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADA_OLD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members' };

const LIST = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 2, inApp: 0, canBeInvited: 2, noEmail: 0, former: 1 },
  statuses: [{ label: 'Active', count: 2, inApp: 0, canBeInvited: 2 }],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [{ key: 'locker', label: 'Locker' }],
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
    extra: [{ key: 'locker', label: 'Locker', value: '' }],
    handEdited: [],
    members: [],
    ...over,
  });
}
const ada = person(ADA, 'Ada Lovelace', { phone: '+447700900123' });
const bea = person(BEA, 'Bea Hart');
const adaOld = person(ADA_OLD, 'Ada Lovelace', { email: 'ada.old@members.example', formerAt: '2026-08-01T10:00:00.000Z' });

/** The list's row for a person: their page without its page-only parts. */
const row = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !['extra', 'handEdited', 'members'].includes(k)));
const entryAnswer = (p) => ({ data: { entry: p } });
const written = (outcome, p) => ({ data: { outcome, entry: p, version: 4 } });
const pageOf = (people) => ({ data: { page: memberListEntriesPageSchema.parse({ total: people.length, entries: people.map(row), cursor: null }) } });
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

function later() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let onClose;
let onChanged;

function openBox(entryId, extra = {}) {
  return render(
    <MemberListPerson
      gymId={GYM}
      entryId={entryId}
      list={LIST}
      words={WORDS}
      readOnly={false}
      onClose={onClose}
      onChanged={onChanged}
      {...extra}
    />,
  );
}

const dialog = () => within(screen.getByRole('dialog'));

beforeEach(() => {
  vi.clearAllMocks();
  onClose = vi.fn();
  onChanged = vi.fn();
  orgService.getMemberList.mockResolvedValue({ data: { list: LIST } });
  orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, bea]));
  orgService.getMemberListEntry.mockImplementation((_gym, id) =>
    Promise.resolve(entryAnswer({ [ADA]: ada, [BEA]: bea, [ADA_OLD]: adaOld }[id])),
  );
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('the worst thing: one person tapped, another shown or changed', () => {
  it('never shows a late answer for somebody tapped earlier, and saves to the person on screen', async () => {
    const adaRead = later();
    const beaRead = later();
    orgService.getMemberListEntry.mockImplementation((_gym, id) => (id === ADA ? adaRead.promise : beaRead.promise));
    render(<MemberListPanel gymId={GYM} words={WORDS} readOnly={false} refreshKey={0} />);

    const rows = await screen.findAllByTestId('list-row');
    fireEvent.click(rows[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getAllByTestId('list-row')[1]);

    // Ada's answer arrives after Bea was tapped.
    adaRead.resolve(entryAnswer(ada));
    await new Promise((r) => setTimeout(r, 0));
    expect(dialog().queryByText('Ada Lovelace')).toBeNull();
    expect(dialog().queryByText('ada@members.example')).toBeNull();

    beaRead.resolve(entryAnswer(bea));
    expect(await dialog().findByText('bea@members.example')).toBeTruthy();
    expect(dialog().queryByText('ada@members.example')).toBeNull();

    orgService.changeMemberListEntry.mockResolvedValue(written('changed', { ...bea, phone: '+447700900555' }));
    fireEvent.click(dialog().getByRole('button', { name: 'Change' }));
    fireEvent.change(dialog().getByLabelText('Phone'), { target: { value: '+447700900555' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.changeMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.changeMemberListEntry).toHaveBeenCalledWith(GYM, BEA, { phone: '+447700900555' });
  });

  it('refuses an answer about a different record than the one it asked for', async () => {
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(bea));
    openBox(ADA);
    expect(await dialog().findByText(/couldn't open this person/i)).toBeTruthy();
    expect(dialog().queryByText('Bea Hart')).toBeNull();
    expect(dialog().queryByText('bea@members.example')).toBeNull();
  });

  it("opens the other record from a clash with nothing of the first one left on screen", async () => {
    const beaRead = later();
    orgService.getMemberListEntry.mockImplementation((_gym, id) => (id === ADA ? Promise.resolve(entryAnswer(ada)) : beaRead.promise));
    orgService.changeMemberListEntry.mockRejectedValue(
      refusal(409, { error: 'already_on_list', message: 'This person is already on your list.', entryId: BEA }),
    );
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Change' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    fireEvent.click(await dialog().findByRole('button', { name: 'Open that record' }));

    expect(dialog().queryByText('Ada Lovelace')).toBeNull();
    expect(dialog().queryByDisplayValue('bea@members.example')).toBeNull();
    beaRead.resolve(entryAnswer(bea));
    expect(await dialog().findByText('Bea Hart')).toBeTruthy();
    expect(orgService.getMemberListEntry).toHaveBeenLastCalledWith(GYM, BEA);
  });

  it('Join removes the record shown under Remove and keeps the one under Keep, both ways round', async () => {
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, adaOld]));
    orgService.mergeMemberListEntries.mockResolvedValue(written('merged', { ...adaOld, formerAt: null }));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Join with another record' }));
    fireEvent.change(dialog().getByLabelText('Find the other record'), { target: { value: 'ada' } });
    // The record the page is open on is never offered as its own other half.
    const pick = await dialog().findByRole('button', { name: /ada\.old@members\.example/ });
    expect(dialog().queryByRole('button', { name: /^Ada Lovelace ada@members\.example/ })).toBeNull();
    fireEvent.click(pick);

    // Started from the record they do not want, as PushPress does: this one goes.
    expect(within(screen.getByTestId('join-keep')).getByText(/ada\.old@members\.example/)).toBeTruthy();
    expect(within(screen.getByTestId('join-remove')).getByText(/^ada@members\.example/)).toBeTruthy();

    // Swapped: now this one stays and the other goes, and the request follows the cards.
    fireEvent.click(dialog().getByRole('button', { name: 'Keep the other one instead' }));
    expect(within(screen.getByTestId('join-keep')).getByText(/^ada@members\.example/)).toBeTruthy();
    expect(within(screen.getByTestId('join-remove')).getByText(/ada\.old@members\.example/)).toBeTruthy();
    orgService.mergeMemberListEntries.mockResolvedValue(written('merged', ada));
    fireEvent.click(dialog().getByRole('button', { name: 'Join the records' }));
    await waitFor(() => expect(orgService.mergeMemberListEntries).toHaveBeenCalledTimes(1));
    expect(orgService.mergeMemberListEntries).toHaveBeenCalledWith(GYM, ADA_OLD, ADA, false);
    expect(await dialog().findByText(/two records are joined/i)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('Join as first offered removes this record and keeps the one picked, then shows the kept one', async () => {
    orgService.getMemberListEntries.mockResolvedValue(pageOf([adaOld]));
    orgService.mergeMemberListEntries.mockResolvedValue(written('merged', { ...adaOld, formerAt: null }));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Join with another record' }));
    fireEvent.change(dialog().getByLabelText('Find the other record'), { target: { value: 'ada' } });
    fireEvent.click(await dialog().findByRole('button', { name: /ada\.old@members\.example/ }));
    fireEvent.click(dialog().getByRole('button', { name: 'Join the records' }));
    await waitFor(() => expect(orgService.mergeMemberListEntries).toHaveBeenCalledWith(GYM, ADA, ADA_OLD, false));
    expect(await dialog().findByText('ada.old@members.example')).toBeTruthy();
    // A later change goes to the kept record, never to the one removed.
    orgService.changeMemberListEntry.mockResolvedValue(written('changed', adaOld));
    fireEvent.click(dialog().getByRole('button', { name: 'Change' }));
    fireEvent.change(dialog().getByLabelText('Member number'), { target: { value: 'M-1' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.changeMemberListEntry).toHaveBeenCalledWith(GYM, ADA_OLD, { memberNumber: 'M-1' }));
  });
});

describe('a person on the list', () => {
  it("shows every kept field, the gym's own columns and who uses the app", async () => {
    orgService.getMemberListEntry.mockResolvedValue(
      entryAnswer(
        person(ADA, 'Ada Lovelace', {
          phone: '+447700900123',
          membershipType: 'Gold',
          endsOn: '2026-10-03',
          endsOnKind: 'renews',
          inApp: true,
          handEdited: ['phone'],
          extra: [{ key: 'locker', label: 'Locker', value: '12' }],
          members: [{ userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', displayName: 'Ada L', joinedAt: '2026-09-02T10:00:00.000Z', visits: 4, lastVisitOn: '2026-09-20' }],
        }),
      ),
    );
    openBox(ADA);
    expect(await dialog().findByText('+447700900123')).toBeTruthy();
    expect(dialog().getByText('Gold')).toBeTruthy();
    expect(dialog().getByText('Renews 3 October 2026')).toBeTruthy();
    expect(dialog().getByText('Locker')).toBeTruthy();
    expect(dialog().getByText('12')).toBeTruthy();
    expect(dialog().getByText('Uses the app')).toBeTruthy();
    expect(dialog().getByText(/4 visits · last 20 September 2026/)).toBeTruthy();
    expect(dialog().getByText(/Changed by hand: Phone/)).toBeTruthy();
  });

  it('asks before taking somebody off, then shows them as a past member with Put back and Delete for good', async () => {
    const off = { ...ada, formerAt: '2026-09-25T10:00:00.000Z' };
    orgService.takeOffMemberListEntry.mockResolvedValue(written('taken_off', off));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Take off the list' }));
    expect(screen.getByTestId('confirm-take-off')).toBeTruthy();
    expect(orgService.takeOffMemberListEntry).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByRole('button', { name: 'Keep on list' }));
    expect(orgService.takeOffMemberListEntry).not.toHaveBeenCalled();

    fireEvent.click(dialog().getByRole('button', { name: 'Take off the list' }));
    fireEvent.click(within(screen.getByTestId('confirm-take-off')).getByRole('button', { name: 'Take off the list' }));
    await waitFor(() => expect(orgService.takeOffMemberListEntry).toHaveBeenCalledWith(GYM, ADA));
    expect(await dialog().findByText(/Past member · taken off 25 September 2026/)).toBeTruthy();
    expect(dialog().getByRole('button', { name: 'Put back on list' })).toBeTruthy();
    expect(dialog().getByRole('button', { name: 'Delete for good' })).toBeTruthy();
    expect(dialog().queryByRole('button', { name: 'Take off the list' })).toBeNull();

    orgService.restoreMemberListEntry.mockResolvedValue(written('restored', ada));
    fireEvent.click(dialog().getByRole('button', { name: 'Put back on list' }));
    await waitFor(() => expect(orgService.restoreMemberListEntry).toHaveBeenCalledWith(GYM, ADA));
    expect(await dialog().findByText('Back on your list.')).toBeTruthy();
  });

  it('says an invitation stops working when somebody invited is taken off', async () => {
    orgService.getMemberListEntry.mockResolvedValue(
      entryAnswer(person(ADA, 'Ada Lovelace', { invitation: { state: 'pending', invitedAt: '2026-09-20T10:00:00.000Z', email: null, sentAgain: 0, waitingSince: null, notMeAt: null } })),
    );
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Take off the list' }));
    expect(within(screen.getByTestId('confirm-take-off')).getByText(/invitation stops working/)).toBeTruthy();
  });

  it('offers no Delete for good on somebody still on the list', async () => {
    openBox(ADA);
    await dialog().findByRole('button', { name: 'Change' });
    expect(dialog().queryByRole('button', { name: 'Delete for good' })).toBeNull();
  });

  it('deletes a past member for good only on the second tap, and says it was done', async () => {
    orgService.deleteFormerMemberListEntry.mockResolvedValue({ data: { deleted: true, version: 5 } });
    openBox(ADA_OLD);
    fireEvent.click(await dialog().findByRole('button', { name: 'Delete for good' }));
    expect(orgService.deleteFormerMemberListEntry).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId('confirm-delete')).getByRole('button', { name: 'Delete for good' }));
    await waitFor(() => expect(orgService.deleteFormerMemberListEntry).toHaveBeenCalledWith(GYM, ADA_OLD));
    expect((await screen.findByTestId('deleted-note')).textContent).toMatch(/Ada Lovelace's record was deleted/);
    expect(onChanged).toHaveBeenCalled();
  });

  it("goes ahead with a change that leaves app members off the list only when staff say so", async () => {
    orgService.changeMemberListEntry
      .mockRejectedValueOnce(refusal(409, { error: 'leaves_list', message: 'This would leave people who use the app off your list.', members: 1 }))
      .mockResolvedValueOnce(written('changed', { ...ada, email: 'new@members.example' }));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Change' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'new@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    expect(await dialog().findByText(/leave people who use the app off your list/)).toBeTruthy();
    expect(orgService.changeMemberListEntry).toHaveBeenLastCalledWith(GYM, ADA, { email: 'new@members.example' });
    fireEvent.click(dialog().getByRole('button', { name: 'Go ahead anyway' }));
    await waitFor(() =>
      expect(orgService.changeMemberListEntry).toHaveBeenLastCalledWith(GYM, ADA, { email: 'new@members.example', acknowledgeLeavesList: true }),
    );
    expect(await dialog().findByText('Saved.')).toBeTruthy();
  });

  it("prints the server's own sentence when a change is refused", async () => {
    orgService.changeMemberListEntry.mockRejectedValue(refusal(400, { error: 'bad_email', message: "That email address doesn't look right. Check it and try again." }));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Change' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    expect(await dialog().findByText(/doesn't look right/)).toBeTruthy();
  });

  it('greys every change on a gym whose plan has lapsed', async () => {
    openBox(ADA, { readOnly: true });
    expect((await dialog().findByRole('button', { name: 'Change' })).disabled).toBe(true);
    expect(dialog().getByRole('button', { name: 'Take off the list' }).disabled).toBe(true);
    expect(dialog().getByRole('button', { name: 'Join with another record' }).disabled).toBe(true);
  });

  it('closes only by its X', async () => {
    openBox(ADA);
    await dialog().findByText('ada@members.example');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('member-person'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Add member', () => {
  it('sends the boxes filled in, then shows the person added', async () => {
    const added = person(BEA, 'Bea Hart', { extra: [{ key: 'locker', label: 'Locker', value: '7' }] });
    orgService.addMemberListEntry.mockResolvedValue(written('added', added));
    openBox(null);
    expect(dialog().getByRole('heading', { name: 'Add member' })).toBeTruthy();
    fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'Bea Hart' } });
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.change(dialog().getByLabelText('Locker'), { target: { value: '7' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    await waitFor(() =>
      expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example', extra: { locker: '7' } }),
    );
    expect(await dialog().findByText('Added to your list.')).toBeTruthy();
    expect(dialog().getByText('bea@members.example')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the person already on the list rather than a second copy', async () => {
    orgService.addMemberListEntry.mockResolvedValue(written('already_on_list', bea));
    openBox(null);
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    expect(await dialog().findByText('This person is already on your list.')).toBeTruthy();
    expect(dialog().getByText('Bea Hart')).toBeTruthy();
  });
});
