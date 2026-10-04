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
import {
  MEMBER_LIST_QUERY_MAX_CHARS,
  memberListEntryDetailSchema,
  memberListEntriesPageSchema,
  memberListMayBeOnListSchema,
  memberListViewSchema,
} from '@app/shared';

// The person's Memberships box (17a-ii) has its own tests in `memberMemberships.render.test.jsx`.
vi.mock('./MemberMemberships', () => ({ default: () => null }));

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
      notThem: vi.fn(),
      inviteMemberListEntry: vi.fn(),
      resendMemberListInvite: vi.fn(),
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
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', personCap: 'Member', it: 'gym' };

const LIST = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 2, inApp: 0, canBeInvited: 2, noEmail: 0, former: 1 },
  statuses: [{ label: 'Active', count: 2, inApp: 0, canBeInvited: 2 }],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [{ key: 'locker', label: 'Locker' }],
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
      canRemove
      onClose={onClose}
      onChanged={onChanged}
      {...extra}
    />,
  );
}

const dialog = () => within(screen.getAllByRole('dialog')[0]);
/** Open "More" on a person's page and pick one of its items. */
const pickMore = async (name) => {
  fireEvent.click(await dialog().findByRole('button', { name: /^More/ }));
  fireEvent.click(await dialog().findByRole('menuitem', { name: new RegExp(`^${name}`) }));
};

beforeEach(() => {
  // Reset, not clear: a queued answer a failed test never used must not reach the next test.
  vi.resetAllMocks();
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
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }));
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
    fireEvent.click(await dialog().findByRole('button', { name: 'Edit' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    fireEvent.click(await dialog().findByRole('button', { name: 'Open that record' }));

    expect(dialog().queryByText('Ada Lovelace')).toBeNull();
    expect(dialog().queryByDisplayValue('bea@members.example')).toBeNull();
    beaRead.resolve(entryAnswer(bea));
    expect(await dialog().findByText('Bea Hart')).toBeTruthy();
    expect(orgService.getMemberListEntry).toHaveBeenLastCalledWith(GYM, BEA);
  });

  it("5b-v-c: after Open that record, the App word, the Invite question and its press are all the second person's", async () => {
    const adaInApp = { ...ada, inApp: true, app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' } };
    const beaRead = later();
    orgService.getMemberListEntry.mockImplementation((_gym, id) => (id === ADA ? Promise.resolve(entryAnswer(adaInApp)) : beaRead.promise));
    orgService.changeMemberListEntry.mockRejectedValue(
      refusal(409, { error: 'already_on_list', message: 'This person is already on your list.', entryId: BEA }),
    );
    orgService.inviteMemberListEntry.mockResolvedValue({ data: { invite: { outcome: 'queued', invitation: null } } });
    openBox(ADA);
    expect(await dialog().findByText('In the app')).toBeTruthy();
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    fireEvent.click(await dialog().findByRole('button', { name: 'Open that record' }));
    // While Bea is read, nothing of Ada's stays: not her name, not her App word.
    expect(dialog().queryByText('In the app')).toBeNull();
    expect(dialog().queryByRole('heading', { name: 'Ada Lovelace' })).toBeNull();
    beaRead.resolve(entryAnswer(bea));
    expect(await dialog().findByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
    expect(dialog().getByText('Not in the app')).toBeTruthy();

    fireEvent.click(dialog().getByRole('button', { name: 'Invite to app' }));
    const ask = within(dialog().getByTestId('confirm-invite'));
    expect(ask.getByText('Invite Bea Hart to the app?')).toBeTruthy();
    expect(ask.getByText('One email goes to bea@members.example with a link to the app.')).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(orgService.inviteMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.inviteMemberListEntry).toHaveBeenCalledWith(GYM, BEA);
  });

  it('Merge keeps the column staff chose and removes the other; the columns never move', async () => {
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, adaOld]));
    orgService.mergeMemberListEntries.mockResolvedValue(written('merged', { ...adaOld, formerAt: null }));
    openBox(ADA);
    await pickMore('Merge duplicate');
    fireEvent.change(dialog().getByLabelText('Find the other record'), { target: { value: 'ada' } });
    // The record the page is open on is never offered as its own other half.
    const pick = await dialog().findByRole('button', { name: /ada\.old@members\.example/ });
    expect(dialog().queryByRole('button', { name: /^Ada Lovelace ada@members\.example/ })).toBeNull();
    fireEvent.click(pick);

    // The record the page is open on is the first column, the one picked the second, and
    // nothing is kept or removed until staff choose.
    expect((await screen.findByTestId('join-first-email')).textContent).toBe('ada@members.example');
    expect(screen.getByTestId('join-second-email').textContent).toBe('ada.old@members.example');
    expect(orgService.getMemberListEntry).toHaveBeenLastCalledWith(GYM, ADA_OLD);
    expect(dialog().getByRole('button', { name: 'Merge' }).disabled).toBe(true);
    expect(dialog().queryByTestId('merge-preview')).toBeNull();

    // Keep the old one, then change the mind: the columns stay where they are, and the
    // request follows the last choice.
    fireEvent.click(dialog().getByTestId('keep-second'));
    expect(dialog().getByTestId('keep-second').textContent).toBe('Keeping');
    expect(dialog().getByTestId('keep-first').textContent).toBe('Removed');
    fireEvent.click(dialog().getByTestId('keep-first'));
    expect(dialog().getByTestId('keep-first').getAttribute('aria-checked')).toBe('true');
    expect(dialog().getByTestId('keep-second').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('join-first-email').textContent).toBe('ada@members.example');
    expect(within(dialog().getByTestId('merge-preview')).getByTestId('after-email').textContent).toBe('ada@members.example');
    orgService.mergeMemberListEntries.mockResolvedValue(written('merged', ada));
    fireEvent.click(dialog().getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(orgService.mergeMemberListEntries).toHaveBeenCalledTimes(1));
    expect(orgService.mergeMemberListEntries).toHaveBeenCalledWith(GYM, ADA_OLD, ADA, false);
    expect(await dialog().findByText(/Records merged\. This is the record you kept/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('Keeping the record picked removes this one, then shows the kept one', async () => {
    const merged = { ...adaOld, formerAt: null };
    orgService.getMemberListEntries.mockResolvedValue(pageOf([adaOld]));
    orgService.mergeMemberListEntries.mockImplementation(() => {
      // The server now holds the kept record back on the list.
      orgService.getMemberListEntry.mockImplementation((_gym, id) => Promise.resolve(entryAnswer(id === ADA_OLD ? merged : ada)));
      return Promise.resolve(written('merged', merged));
    });
    openBox(ADA);
    await pickMore('Merge duplicate');
    fireEvent.change(dialog().getByLabelText('Find the other record'), { target: { value: 'ada' } });
    fireEvent.click(await dialog().findByRole('button', { name: /ada\.old@members\.example/ }));
    fireEvent.click(await dialog().findByTestId('keep-second'));
    fireEvent.click(dialog().getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(orgService.mergeMemberListEntries).toHaveBeenCalledWith(GYM, ADA, ADA_OLD, false));
    expect(await dialog().findByText(/Records merged\. This is the record you kept/)).toBeTruthy();
    expect(dialog().getByText('ada.old@members.example')).toBeTruthy();
    // A later change goes to the kept record, never to the one removed.
    orgService.changeMemberListEntry.mockResolvedValue(written('changed', adaOld));
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }));
    fireEvent.change(dialog().getByLabelText('Member number'), { target: { value: 'M-1' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.changeMemberListEntry).toHaveBeenCalledWith(GYM, ADA_OLD, { memberNumber: 'M-1' }));
  });
});

describe('round one: a confirm only ever sends what was refused', () => {
  const leaves = () => refusal(409, { error: 'leaves_list', message: 'This would leave people who use the app off your list.', members: 1 });

  it('C1: after a refused merge, choosing the other record takes the old confirm away, and Merge then sends the new choice', async () => {
    orgService.getMemberListEntries.mockResolvedValue(pageOf([adaOld]));
    orgService.mergeMemberListEntries.mockRejectedValueOnce(leaves()).mockResolvedValueOnce(written('merged', ada));
    openBox(ADA);
    await pickMore('Merge duplicate');
    fireEvent.click(await dialog().findByRole('button', { name: /ada\.old@members\.example/ }));
    fireEvent.click(await dialog().findByTestId('keep-second'));
    fireEvent.click(dialog().getByRole('button', { name: 'Merge' }));
    expect(await dialog().findByRole('button', { name: 'Go ahead anyway' })).toBeTruthy();
    expect(orgService.mergeMemberListEntries).toHaveBeenLastCalledWith(GYM, ADA, ADA_OLD, false);

    fireEvent.click(dialog().getByTestId('keep-first'));
    expect(dialog().queryByRole('button', { name: 'Go ahead anyway' })).toBeNull();
    expect(dialog().getByTestId('keep-first').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(dialog().getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(orgService.mergeMemberListEntries).toHaveBeenCalledTimes(2));
    expect(orgService.mergeMemberListEntries).toHaveBeenLastCalledWith(GYM, ADA_OLD, ADA, false);
  });

  it('C1: "Go ahead anyway" sends exactly the merge that was refused', async () => {
    orgService.getMemberListEntries.mockResolvedValue(pageOf([adaOld]));
    orgService.mergeMemberListEntries.mockRejectedValueOnce(leaves()).mockResolvedValueOnce(written('merged', adaOld));
    openBox(ADA);
    await pickMore('Merge duplicate');
    fireEvent.click(await dialog().findByRole('button', { name: /ada\.old@members\.example/ }));
    fireEvent.click(await dialog().findByTestId('keep-second'));
    fireEvent.click(dialog().getByRole('button', { name: 'Merge' }));
    fireEvent.click(await dialog().findByRole('button', { name: 'Go ahead anyway' }));
    await waitFor(() => expect(orgService.mergeMemberListEntries).toHaveBeenCalledTimes(2));
    expect(orgService.mergeMemberListEntries).toHaveBeenLastCalledWith(GYM, ADA, ADA_OLD, true);
  });

  it('H1: a box changed after a refused save takes the old confirm away, and Save sends the form as it is now', async () => {
    orgService.changeMemberListEntry.mockRejectedValueOnce(leaves()).mockResolvedValueOnce(written('changed', ada));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Edit' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'new@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    expect(await dialog().findByRole('button', { name: 'Go ahead anyway' })).toBeTruthy();
    fireEvent.change(dialog().getByLabelText('Status'), { target: { value: 'Frozen' } });
    expect(dialog().queryByRole('button', { name: 'Go ahead anyway' })).toBeNull();
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.changeMemberListEntry).toHaveBeenCalledTimes(2));
    expect(orgService.changeMemberListEntry).toHaveBeenLastCalledWith(GYM, ADA, { email: 'new@members.example', status: 'Frozen' });
  });

  it('H1: "Go ahead anyway" sends exactly the change that was refused', async () => {
    orgService.changeMemberListEntry.mockRejectedValueOnce(leaves()).mockResolvedValueOnce(written('changed', ada));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Edit' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'new@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    fireEvent.click(await dialog().findByRole('button', { name: 'Go ahead anyway' }));
    await waitFor(() => expect(orgService.changeMemberListEntry).toHaveBeenCalledTimes(2));
    expect(orgService.changeMemberListEntry).toHaveBeenLastCalledWith(GYM, ADA, { email: 'new@members.example', acknowledgeLeavesList: true });
  });

  it('H3: after Remove from list then Delete for good, nothing still says the record is kept', async () => {
    orgService.takeOffMemberListEntry.mockResolvedValue(written('taken_off', { ...ada, formerAt: '2026-09-25T10:00:00.000Z' }));
    orgService.deleteFormerMemberListEntry.mockResolvedValue({ data: { deleted: true, version: 6 } });
    openBox(ADA);
    await pickMore('Remove');
    fireEvent.click(within(screen.getByTestId('confirm-take-off')).getByRole('button', { name: 'Remove' }));
    expect(await dialog().findByText(/Their details are kept/)).toBeTruthy();
    await pickMore('Delete for good');
    fireEvent.click(within(screen.getByTestId('confirm-delete')).getByRole('button', { name: 'Delete for good' }));
    await screen.findByTestId('deleted-note');
    expect(dialog().queryByText(/Their details are kept/)).toBeNull();
  });

  it('L1: the Merge search takes no more than the server reads', async () => {
    openBox(ADA);
    await pickMore('Merge duplicate');
    expect(dialog().getByLabelText('Find the other record').getAttribute('maxLength')).toBe(String(MEMBER_LIST_QUERY_MAX_CHARS));
  });
});
describe("5b-v-c: the one main button, and Invite asks first (spec Part 3 §18.6, §18.7)", () => {
  const went = { state: 'sent', reason: null, at: '2026-09-20T10:01:00.000Z', result: 'delivered' };
  const pending = { state: 'pending', invitedAt: '2026-09-20T10:00:00.000Z', email: went, sentAgain: 0, waitingSince: null, notMeAt: null };
  const cases = [
    ['not invited, with an email', {}, 'Invite to app'],
    ['invited', { invitation: pending, app: { word: 'invited', tone: 'grey', at: '2026-09-20T10:00:00.000Z', line: null, lineTone: 'plain' } }, 'Send again'],
    [
      'removed from the app',
      {
        invitation: { ...pending, state: 'withdrawn', removedAt: '2026-09-26T09:30:00.000Z', addressRemovedAt: null, wrongPersonAt: null },
        app: { word: 'not_in_app', tone: 'grey', at: '2026-09-26T09:30:00.000Z', line: 'Removed from app · 26 Sep', lineTone: 'plain' },
      },
      'Invite again',
    ],
    ['in the app', { inApp: true, app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' } }, 'Edit'],
    ['with no email', { email: null, phone: '+447700900123' }, 'Edit'],
    ['under 18', { dateOfBirth: '2015-03-14', app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Under 18', lineTone: 'plain' } }, 'Edit'],
    ['a past member', { formerAt: '2026-08-01T10:00:00.000Z' }, 'Put back on your list'],
  ];
  it.each(cases)('%s: one orange button, and it is the right one', async (_label, over, main) => {
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(person(ADA, 'Ada Lovelace', over)));
    openBox(ADA);
    await dialog().findByRole('heading', { name: 'Ada Lovelace' });
    const orange = dialog()
      .getAllByRole('button')
      .filter((b) => b.classList.contains('c-btn-p'));
    expect(orange.map((b) => b.textContent)).toEqual([main]);
  });

  it('Invite to app names the person and the address first; Cancel sends nothing', async () => {
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Invite to app' }));
    const ask = within(dialog().getByTestId('confirm-invite'));
    expect(ask.getByText('Invite Ada Lovelace to the app?')).toBeTruthy();
    expect(ask.getByText('One email goes to ada@members.example with a link to the app.')).toBeTruthy();
    expect(orgService.inviteMemberListEntry).not.toHaveBeenCalled();
    fireEvent.click(ask.getByRole('button', { name: 'Cancel' }));
    expect(dialog().queryByTestId('confirm-invite')).toBeNull();
    expect(dialog().getByRole('button', { name: 'Invite to app' })).toBeTruthy();
    expect(orgService.inviteMemberListEntry).not.toHaveBeenCalled();
  });

  it('opens as a side panel with the App word under the name, in the console look', async () => {
    openBox(ADA);
    await dialog().findByRole('heading', { name: 'Ada Lovelace' });
    expect(screen.getByRole('dialog').classList.contains('c-sheet')).toBe(true);
    expect(dialog().getByText('Not in the app').classList.contains('c-tag')).toBe(true);
  });
});

describe('a person on the list', () => {
  it('shows both records side by side, every field, the ones that differ marked, so two different people can be told apart', async () => {
    const liam = person(ADA, 'Liam Hughes', { email: 'liam.hughes@members.example', phone: '+447700900302', memberNumber: 'M-103', dateOfBirth: '1990-03-12', joinedOn: '2025-03-03', status: 'Frozen', inApp: true, extra: [{ key: 'locker', label: 'Locker', value: '4' }] });
    const other = person(ADA_OLD, 'Liam Hughes', { email: 'liam.h@members.example', phone: null, memberNumber: null, dateOfBirth: '2008-07-01', joinedOn: '2026-09-01', status: 'Active', formerAt: '2026-08-01T10:00:00.000Z' });
    orgService.getMemberListEntry.mockImplementation((_gym, id) => Promise.resolve(entryAnswer(id === ADA ? liam : other)));
    orgService.getMemberListEntries.mockResolvedValue(pageOf([other]));
    openBox(ADA);
    await pickMore('Merge duplicate');
    fireEvent.click(await dialog().findByRole('button', { name: /liam\.h@members\.example/ }));
    const compare = await screen.findByTestId('merge-compare');
    const cell = (side, key) => within(compare).getByTestId(`join-${side}-${key}`).textContent;
    // This record first, the one picked second.
    expect([cell('first', 'dateOfBirth'), cell('second', 'dateOfBirth')]).toEqual(['12 March 1990', '1 July 2008']);
    expect([cell('first', 'joinedOn'), cell('second', 'joinedOn')]).toEqual(['3 March 2025', '1 September 2026']);
    expect([cell('first', 'phone'), cell('second', 'phone')]).toEqual(['+447700900302', '—']);
    expect([cell('first', 'app'), cell('second', 'app')]).toEqual(['Yes', 'No']);
    expect([cell('first', 'list'), cell('second', 'list')]).toEqual(['On the list', 'Past member']);
    expect([cell('first', 'extra:locker'), cell('second', 'extra:locker')]).toEqual(['4', '—']);
    const shaded = [...compare.querySelectorAll('tr[data-differs=true]')].map((r) => r.querySelector('th').textContent);
    expect(shaded).toEqual(['Email', 'Phone', 'Member number', 'Date of birth', 'Join date', 'Status', 'On the list', 'In the app', 'Locker']);
    expect(within(compare).getByText('9 of 10 details differ.')).toBeTruthy();
    // Nothing either record holds is not a row.
    expect(within(compare).queryByTestId('join-first-endsOn')).toBeNull();
    // The name is the same, so it is not marked.
    expect(within(compare).getByTestId('join-first-fullName').textContent).toBe('Liam Hughes');
  });
  it("shows every kept field, the gym's own columns and who uses the app", async () => {
    orgService.getMemberListEntry.mockResolvedValue(
      entryAnswer(
        person(ADA, 'Ada Lovelace', {
          phone: '+447700900123',
          membershipType: 'Gold',
          endsOn: '2026-10-03',
          endsOnKind: 'renews',
          inApp: true,
          app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' },
          handEdited: ['phone'],
          extra: [{ key: 'locker', label: 'Locker', value: '12' }],
          members: [{ userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', displayName: 'Ada L', joinedAt: '2026-09-02T10:00:00.000Z', visits: 4, lastVisitOn: '2026-09-20' }],
        }),
      ),
    );
    openBox(ADA);
    expect(await dialog().findByText('+447700900123')).toBeTruthy();
    expect(dialog().getByText('Gold')).toBeTruthy();
    expect(dialog().getByText('Renews 3 Oct 2026')).toBeTruthy();
    expect(dialog().getByText('Locker')).toBeTruthy();
    expect(dialog().getByText('12')).toBeTruthy();
    // The App word, and the App section of who uses the app.
    expect(dialog().getByText('In the app')).toBeTruthy();
    expect(dialog().getByRole('heading', { name: 'App' })).toBeTruthy();
    expect(dialog().getByText(/4 visits · last 20 September 2026/)).toBeTruthy();
    expect(dialog().getByText(/Changed by hand: Phone/)).toBeTruthy();
  });

  it("Remove names, in its box, whose app access ends, and says less for someone nobody uses the app as (One Remove)", async () => {
    const ADA_APP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    orgService.getMemberListEntry.mockResolvedValue(
      entryAnswer({
        ...ada,
        inApp: true,
        removeEndsApp: true,
        removeEndsAppFor: [ADA_APP],
        members: [{ userId: ADA_APP, displayName: 'Ada L', joinedAt: '2026-09-07T10:00:00.000Z', visits: 2, lastVisitOn: null, sharedEmail: false }],
        app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' },
      }),
    );
    openBox(ADA);
    await pickMore('Remove');
    const box = within(screen.getByTestId('confirm-take-off'));
    expect(box.getByText('Remove Ada Lovelace?')).toBeTruthy();
    expect(box.getByText(/They'll be moved to past members\. Ada L will lose access to your gym in the app\./)).toBeTruthy();
    expect(box.getByText(/you can put them back at any time/)).toBeTruthy();
    cleanup();

    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(ada));
    openBox(ADA);
    await pickMore('Remove');
    const plain = within(screen.getByTestId('confirm-take-off'));
    expect(plain.getByText(/They'll be moved to past members\./)).toBeTruthy();
    expect(plain.queryByText(/use the app/)).toBeNull();
    expect(plain.queryByText(/lose access/)).toBeNull();
  });

  it("a family's shared email the list can't place: the page names her with no Not …?, and Remove says she keeps her access (round one, High-1)", async () => {
    const MUM = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const line = "Mum uses the app with the email address Ada Lovelace and Leo Lovelace share, so we can't tell which of them it is. Give each of them their own email address.";
    orgService.getMemberListEntry.mockResolvedValue(
      entryAnswer({
        ...ada,
        inApp: true,
        removeEndsApp: false,
        removeEndsAppFor: [],
        members: [{ userId: MUM, displayName: 'Mum', joinedAt: '2026-09-07T10:00:00.000Z', visits: 0, lastVisitOn: null, sharedEmail: true }],
        app: { word: 'in_app', tone: 'amber', at: null, line, lineTone: 'amber' },
      }),
    );
    openBox(ADA);
    const who = within(await screen.findByTestId('in-app-person'));
    expect(who.getByText('Mum')).toBeTruthy();
    expect(who.queryByRole('button', { name: /^Not / })).toBeNull();
    expect(dialog().getByText(line)).toBeTruthy();
    await pickMore('Remove');
    const box = within(screen.getByTestId('confirm-take-off'));
    expect(box.getByText(/They'll be moved to past members\. Mum keeps app access: we can't tell whether they are Ada Lovelace\./)).toBeTruthy();
    expect(box.queryByText(/lose access/)).toBeNull();
  });

  it('asks before removing somebody from the list, then shows them as a past member with Put back, and Delete for good under More', async () => {
    const off = { ...ada, formerAt: '2026-09-25T10:00:00.000Z' };
    orgService.takeOffMemberListEntry.mockResolvedValue(written('taken_off', off));
    openBox(ADA);
    await pickMore('Remove');
    expect(screen.getByTestId('confirm-take-off')).toBeTruthy();
    expect(orgService.takeOffMemberListEntry).not.toHaveBeenCalled();
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    expect(orgService.takeOffMemberListEntry).not.toHaveBeenCalled();

    await pickMore('Remove');
    fireEvent.click(within(screen.getByTestId('confirm-take-off')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(orgService.takeOffMemberListEntry).toHaveBeenCalledWith(GYM, ADA));
    expect(await dialog().findByText(/Past member since 25 Sep 2026/)).toBeTruthy();
    expect(dialog().getByRole('button', { name: 'Put back on your list' })).toBeTruthy();
    fireEvent.click(dialog().getByRole('button', { name: /^More/ }));
    expect(dialog().getByRole('menuitem', { name: /^Delete for good/ })).toBeTruthy();
    expect(dialog().queryByRole('menuitem', { name: /^Remove/ })).toBeNull();

    // Put back undoes both (RULINGS 2026-09-27): the answer says whether their app came back.
    orgService.restoreMemberListEntry.mockResolvedValue({ data: { ...written('restored', ada).data, app: 'back' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Put back on your list' }));
    await waitFor(() => expect(orgService.restoreMemberListEntry).toHaveBeenCalledWith(GYM, ADA));
    expect(await dialog().findByText('Put back on your list, with their app access.')).toBeTruthy();
  });

  it('Put back with no free place on the plan says the app access was not given back, and what to do', async () => {
    const off = { ...ada, formerAt: '2026-09-25T10:00:00.000Z' };
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(off));
    openBox(ADA);
    orgService.restoreMemberListEntry.mockResolvedValue({ data: { ...written('restored', ada).data, app: 'no_place' } });
    fireEvent.click(await dialog().findByRole('button', { name: 'Put back on your list' }));
    expect(
      await dialog().findByText(
        "Put back on your list. Their app access wasn't given back because your plan has no free place: invite them again when one is free.",
      ),
    ).toBeTruthy();
  });

  it('someone removed from the app is invited again, asked first, never offered Send again (RULINGS 2026-09-26; round one, Low-8)', async () => {
    const removed = {
      ...ada,
      app: { word: 'not_in_app', tone: 'grey', at: '2026-09-26T09:30:00.000Z', line: 'Removed from app', lineTone: 'plain' },
      invitation: {
        state: 'withdrawn',
        invitedAt: '2026-09-20T10:00:00.000Z',
        email: null,
        sentAgain: 0,
        waitingSince: null,
        notMeAt: null,
        removedAt: '2026-09-26T09:30:00.000Z',
        addressRemovedAt: null,
        wrongPersonAt: null,
      },
    };
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(removed));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Invite again' }));
    expect(dialog().queryByRole('button', { name: 'Send again' })).toBeNull();
    const box = within(screen.getByTestId('confirm-invite-again'));
    expect(box.getByText('Invite Ada Lovelace again?')).toBeTruthy();
    expect(box.getByText(/You removed Ada Lovelace from the app on 26 September 2026\. They'll get one invitation email at/)).toBeTruthy();
    expect(orgService.resendMemberListInvite).not.toHaveBeenCalled();
    // Pressed in the box: one email, through the same door Send again uses.
    orgService.resendMemberListInvite.mockResolvedValue({
      data: { invite: { outcome: 'queued', invitation: { ...removed.invitation, state: 'pending', removedAt: null } } },
    });
    fireEvent.click(box.getByRole('button', { name: 'Invite again' }));
    await waitFor(() => expect(orgService.resendMemberListInvite).toHaveBeenCalledWith(GYM, ADA));
    cleanup();

    // An address staff said is somebody else's is offered nothing.
    const wrong = { ...removed, invitation: { ...removed.invitation, removedAt: null, wrongPersonAt: '2026-09-26T09:30:00.000Z' } };
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(wrong));
    openBox(ADA);
    await dialog().findByRole('button', { name: 'Edit' });
    expect(dialog().queryByRole('button', { name: 'Invite again' })).toBeNull();
    expect(dialog().queryByRole('button', { name: 'Send again' })).toBeNull();
    expect(dialog().queryByRole('button', { name: 'Invite to app' })).toBeNull();
  });

  describe("who uses the app with a record, and Not this person (RULINGS 2026-09-28: the email is the link)", () => {
    const DAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const daniel = {
      ...person(ADA, 'Daniel Wu'),
      inApp: true,
      removeEndsApp: true,
      app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' },
      members: [{ userId: DAN, displayName: 'du', joinedAt: '2026-09-07T10:00:00.000Z', visits: 0, lastVisitOn: null }],
    };

    it('names who uses the app under the name they gave it, and asks nothing about the name', async () => {
      orgService.getMemberListEntry.mockResolvedValue(entryAnswer(daniel));
      openBox(ADA);
      const who = within(await screen.findByTestId('in-app-person'));
      expect(who.getByText('du')).toBeTruthy();
      // Round one of 5b-v-c, L3: §18.3's words, never "joined".
      expect(who.getByText(/· In the app since 7 September 2026/)).toBeTruthy();
      expect(who.queryByText(/joined/)).toBeNull();
      expect(dialog().queryByText(/Check this is them/)).toBeNull();
      expect(who.getByRole('button', { name: 'Not Daniel Wu?' })).toBeTruthy();
    });

    it('Not this person asks first, naming who loses the app and who stays, then takes out that one account', async () => {
      orgService.getMemberListEntry.mockResolvedValue(entryAnswer(daniel));
      openBox(ADA);
      fireEvent.click(within(await screen.findByTestId('in-app-person')).getByRole('button', { name: 'Not Daniel Wu?' }));
      const box = within(screen.getByTestId('confirm-not-them'));
      expect(box.getByText("Remove du's app access?")).toBeTruthy();
      expect(box.getByText(/du uses the app as Daniel Wu\. If du isn't Daniel Wu, remove their access to your gym in the app\./)).toBeTruthy();
      expect(box.getByText(/Daniel Wu stays on your list/)).toBeTruthy();
      fireEvent.click(box.getByRole('button', { name: 'Cancel' }));
      expect(orgService.notThem).not.toHaveBeenCalled();

      fireEvent.click(within(screen.getByTestId('in-app-person')).getByRole('button', { name: 'Not Daniel Wu?' }));
      const out = { ...daniel, inApp: false, removeEndsApp: false, members: [], app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Invitation cancelled', lineTone: 'plain' } };
      orgService.notThem.mockResolvedValue(written('not_them', out));
      fireEvent.click(within(screen.getByTestId('confirm-not-them')).getByRole('button', { name: 'Remove access' }));
      await waitFor(() => expect(orgService.notThem).toHaveBeenCalledWith(GYM, ADA, DAN));
      expect(
        await dialog().findByText('App access removed. Nothing more is sent to that email address: update it with Edit before inviting again.'),
      ).toBeTruthy();
      expect(orgService.takeOffMemberListEntry).not.toHaveBeenCalled();
    });

    it("offers no Not this person on a past member's page: Remove is there for them", async () => {
      orgService.getMemberListEntry.mockResolvedValue(entryAnswer({ ...daniel, formerAt: '2026-09-25T10:00:00.000Z' }));
      openBox(ADA);
      const who = within(await screen.findByTestId('in-app-person'));
      expect(who.queryByRole('button', { name: /^Not / })).toBeNull();
    });
  });

  it("a past member still in the app is removed from it here, as from 'Using the app' (Kd, 2026-09-27: one card in both places)", async () => {
    const grace = {
      ...person(ADA, 'Grace Hall'),
      formerAt: '2026-09-25T10:00:00.000Z',
      inApp: true,
      removeEndsApp: true,
      app: { word: 'in_app', tone: 'amber', at: null, line: "Grace still uses the app through your gym. Remove them from the app if they've left.", lineTone: 'amber' },
    };
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(grace));
    openBox(ADA);
    // §18.7: the amber line and its Remove from app on the page, not under More.
    const line = within(await dialog().findByTestId('past-in-app'));
    expect(line.getByText("Grace still uses the app through your gym. Remove them from the app if they've left.")).toBeTruthy();
    fireEvent.click(dialog().getByRole('button', { name: /^More/ }));
    expect(dialog().queryByRole('menuitem', { name: /^Remove/ })).toBeNull();
    fireEvent.click(line.getByRole('button', { name: 'Remove from app' }));
    const box = within(screen.getByTestId('confirm-take-off'));
    expect(box.getByText("Remove Grace Hall's app access?")).toBeTruthy();
    expect(box.getByText(/already a past member\. This removes their access to your gym in the app\./)).toBeTruthy();
    const done = { ...grace, inApp: false, removeEndsApp: false, app: { word: 'not_in_app', tone: 'grey', at: '2026-09-27T10:00:00.000Z', line: 'Removed from app', lineTone: 'plain' } };
    orgService.takeOffMemberListEntry.mockResolvedValue(written('removed_from_app', done));
    // Round one of 5b-v-c, L2: the button says what it takes away.
    expect(box.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.click(box.getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(orgService.takeOffMemberListEntry).toHaveBeenCalledWith(GYM, ADA));
    expect(await dialog().findByText('App access removed. They remain a past member.')).toBeTruthy();
  });

  it('offers no Remove on a past member whose Remove would change nothing', async () => {
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer({ ...person(ADA, 'Sam Park'), formerAt: '2026-09-25T10:00:00.000Z', removeEndsApp: false }));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: /^More/ }));
    expect(dialog().getByRole('menuitem', { name: /^Delete for good/ })).toBeTruthy();
    expect(dialog().queryByRole('menuitem', { name: /^Remove/ })).toBeNull();
    expect(dialog().queryByRole('button', { name: 'Remove from app' })).toBeNull();
  });

  it('says an invitation stops working when somebody invited is removed from the list', async () => {
    orgService.getMemberListEntry.mockResolvedValue(
      entryAnswer(person(ADA, 'Ada Lovelace', { invitation: { state: 'pending', invitedAt: '2026-09-20T10:00:00.000Z', email: null, sentAgain: 0, waitingSince: null, notMeAt: null } })),
    );
    openBox(ADA);
    await pickMore('Remove');
    expect(within(screen.getByTestId('confirm-take-off')).getByText(/pending invitation will be cancelled/)).toBeTruthy();
  });

  it('offers no Delete for good on somebody still on the list', async () => {
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: /^More/ }));
    expect(dialog().getByRole('menuitem', { name: /^Merge duplicate/ })).toBeTruthy();
    expect(dialog().queryByRole('menuitem', { name: /^Delete for good/ })).toBeNull();
  });

  it('starts Merge duplicate with the name already searched, so a second record under it shows at once', async () => {
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, adaOld]));
    openBox(ADA);
    await pickMore('Merge duplicate');
    expect(dialog().getByLabelText('Find the other record').value).toBe('Ada Lovelace');
    expect(await dialog().findByRole('button', { name: /ada\.old@members\.example/ })).toBeTruthy();
    expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'records=all&query=Ada+Lovelace');
  });

  it('deletes a past member for good only on the second tap, and says it was done', async () => {
    orgService.deleteFormerMemberListEntry.mockResolvedValue({ data: { deleted: true, version: 5 } });
    openBox(ADA_OLD);
    await pickMore('Delete for good');
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
    fireEvent.click(await dialog().findByRole('button', { name: 'Edit' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'new@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    expect(await dialog().findByText(/leave people who use the app off your list/)).toBeTruthy();
    expect(orgService.changeMemberListEntry).toHaveBeenLastCalledWith(GYM, ADA, { email: 'new@members.example' });
    fireEvent.click(dialog().getByRole('button', { name: 'Go ahead anyway' }));
    await waitFor(() =>
      expect(orgService.changeMemberListEntry).toHaveBeenLastCalledWith(GYM, ADA, { email: 'new@members.example', acknowledgeLeavesList: true }),
    );
    expect(await dialog().findByText('Changes saved.')).toBeTruthy();
  });

  it("prints the server's own sentence when a change is refused", async () => {
    orgService.changeMemberListEntry.mockRejectedValue(refusal(400, { error: 'bad_email', message: "That email address doesn't look right. Check it and try again." }));
    openBox(ADA);
    fireEvent.click(await dialog().findByRole('button', { name: 'Edit' }));
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    expect(await dialog().findByText(/doesn't look right/)).toBeTruthy();
  });

  it("round one of 5b-v-c, L1: without members.remove, nothing that ends somebody's app is offered", async () => {
    const DAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const inApp = {
      ...person(ADA, 'Daniel Wu'),
      inApp: true,
      removeEndsApp: true,
      app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' },
      members: [{ userId: DAN, displayName: 'du', joinedAt: '2026-09-07T10:00:00.000Z', visits: 0, lastVisitOn: null }],
    };
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(inApp));
    openBox(ADA, { canRemove: false });
    const who = within(await screen.findByTestId('in-app-person'));
    expect(who.queryByRole('button', { name: /^Not / })).toBeNull();
    fireEvent.click(dialog().getByRole('button', { name: /^More/ }));
    expect(dialog().queryByRole('menuitem', { name: /^Remove/ })).toBeNull();
    expect(dialog().getByRole('menuitem', { name: /^Merge duplicate/ })).toBeTruthy();
    cleanup();

    // A past member still in the app: the amber line stays, its button goes.
    const grace = { ...person(ADA, 'Grace Hall'), formerAt: '2026-09-25T10:00:00.000Z', inApp: true, removeEndsApp: true };
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(grace));
    openBox(ADA, { canRemove: false });
    const line = within(await dialog().findByTestId('past-in-app'));
    expect(line.getByText(/Grace Hall is still in the app through your gym\./)).toBeTruthy();
    expect(line.queryByRole('button', { name: 'Remove from app' })).toBeNull();
    cleanup();

    // Nobody uses the app with this record: Remove only moves it, which the list's tick allows.
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(ada));
    openBox(ADA, { canRemove: false });
    fireEvent.click(await dialog().findByRole('button', { name: /^More/ }));
    expect(dialog().getByRole('menuitem', { name: /^Remove/ })).toBeTruthy();
  });

  it('greys every change on a gym whose plan has lapsed', async () => {
    openBox(ADA, { readOnly: true });
    expect((await dialog().findByRole('button', { name: 'Edit' })).disabled).toBe(true);
    expect(dialog().getByRole('button', { name: /^More/ }).disabled).toBe(true);
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
    expect(await dialog().findByText('Member added.')).toBeTruthy();
    expect(dialog().getByText('bea@members.example')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the person already on the list rather than a second copy', async () => {
    orgService.addMemberListEntry.mockResolvedValue(written('already_on_list', bea));
    openBox(null);
    fireEvent.change(dialog().getByLabelText('Email'), { target: { value: 'bea@members.example' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    expect(await dialog().findByText('They are already on your list.')).toBeTruthy();
    expect(dialog().getByText('Bea Hart')).toBeTruthy();
  });
});

// ── May already be on your list (5b-iv-b; RULINGS 2026-09-30) ──
describe('Add member: may already be on your list', () => {
  const LIAM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const LIAM_PAST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const maybeRefusal = () =>
    refusal(
      409,
      memberListMayBeOnListSchema.parse({
        error: 'may_be_on_list',
        message: 'This person may already be on your list. Open a record to check, or add them anyway.',
        people: [
          { entryId: LIAM, fullName: 'Liam Hughes', email: 'liam@members.example', phone: null, memberNumber: 'GG-0042', past: false, sameName: true, samePhone: false, sameMemberNumber: true },
          { entryId: LIAM_PAST, fullName: 'Hughes, Liam', email: null, phone: '+919876543210', memberNumber: null, past: true, sameName: true, samePhone: true, sameMemberNumber: false },
        ],
      }),
    );
  const typeLiam = () => {
    fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'Liam Hughes' } });
    fireEvent.change(dialog().getByLabelText('Phone'), { target: { value: '9876543210' } });
  };

  it('names each record alike and what it shares, adds nobody, and Add anyway sends exactly the details warned about', async () => {
    orgService.addMemberListEntry.mockRejectedValueOnce(maybeRefusal());
    openBox(null);
    typeLiam();
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    const box = within(await dialog().findByTestId('maybe-box'));
    expect(box.getByRole('heading', { name: 'Liam Hughes may already be on your list' })).toBeTruthy();
    const rows = box.getAllByTestId('maybe-match').map((li) => li.textContent);
    expect(rows).toEqual([
      'Liam Hughesliam@members.example · Member number GG-0042Same name and member numberOpen',
      'Hughes, LiamPast member+919876543210Same name and phoneOpen',
    ]);
    expect(dialog().queryByText('Member added.')).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();

    orgService.addMemberListEntry.mockResolvedValueOnce(written('added', person(ADA, 'Liam Hughes', { phone: '+919876543210' })));
    fireEvent.click(box.getByRole('button', { name: 'Add anyway' }));
    await waitFor(() =>
      expect(orgService.addMemberListEntry).toHaveBeenLastCalledWith(GYM, { fullName: 'Liam Hughes', phone: '9876543210', acknowledgedDuplicates: [LIAM, LIAM_PAST] }),
    );
    expect(await dialog().findByText('Member added.')).toBeTruthy();
    expect(dialog().queryByTestId('maybe-box')).toBeNull();
  });

  it('brings the warning into view and puts the focus on it, since Add member sits at the bottom of a long form', async () => {
    const scrolled = [];
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this);
    };
    try {
      orgService.addMemberListEntry.mockRejectedValueOnce(maybeRefusal());
      openBox(null);
      typeLiam();
      fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
      const box = await dialog().findByTestId('maybe-box');
      await waitFor(() => expect(scrolled.some((el) => el.contains(box))).toBe(true));
      expect(document.activeElement?.contains(box)).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = before;
    }
  });

  it('brings a refusal into view the same way', async () => {
    const scrolled = [];
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this);
    };
    try {
      orgService.addMemberListEntry.mockRejectedValueOnce(refusal(400, { error: 'bad_phone', message: "That phone number doesn't look right." }));
      openBox(null);
      typeLiam();
      fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
      const alert = await dialog().findByText("That phone number doesn't look right.");
      await waitFor(() => expect(scrolled.some((el) => el.contains(alert))).toBe(true));
      expect(document.activeElement?.contains(alert)).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = before;
    }
  });

  it('Add and invite warns first, and only Add and invite anyway invites', async () => {
    orgService.addMemberListEntry.mockRejectedValueOnce(maybeRefusal());
    openBox(null);
    typeLiam();
    fireEvent.click(dialog().getByRole('button', { name: 'Add and invite' }));
    const box = within(await dialog().findByTestId('maybe-box'));
    expect(box.queryByRole('button', { name: 'Add anyway' })).toBeNull();
    orgService.addMemberListEntry.mockResolvedValueOnce(written('added', person(ADA, 'Liam Hughes')));
    fireEvent.click(box.getByRole('button', { name: 'Add and invite anyway' }));
    await waitFor(() =>
      expect(orgService.addMemberListEntry).toHaveBeenLastCalledWith(GYM, {
        fullName: 'Liam Hughes',
        phone: '9876543210',
        invite: true,
        acknowledgedDuplicates: [LIAM, LIAM_PAST],
      }),
    );
  });

  it('changing a box takes the warning away, so Add anyway never sends details it did not warn about', async () => {
    orgService.addMemberListEntry.mockRejectedValueOnce(maybeRefusal());
    openBox(null);
    typeLiam();
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    await dialog().findByTestId('maybe-box');
    fireEvent.change(dialog().getByLabelText('Phone'), { target: { value: '9876500000' } });
    expect(dialog().queryByTestId('maybe-box')).toBeNull();
    expect(dialog().queryByRole('button', { name: 'Add anyway' })).toBeNull();
    orgService.addMemberListEntry.mockRejectedValueOnce(maybeRefusal());
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenLastCalledWith(GYM, { fullName: 'Liam Hughes', phone: '9876500000' }));
    await dialog().findByTestId('maybe-box');
    // One of the gym's own columns counts the same as a standard one.
    fireEvent.change(dialog().getByLabelText('Locker'), { target: { value: '12' } });
    expect(dialog().queryByTestId('maybe-box')).toBeNull();
  });

  it('a record alike added since the warning brings it back, saying so, and Add anyway then names every record shown', async () => {
    const OMAR = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    orgService.addMemberListEntry.mockRejectedValueOnce(maybeRefusal());
    openBox(null);
    typeLiam();
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    await dialog().findByTestId('maybe-box');
    expect(dialog().queryByTestId('maybe-again')).toBeNull();
    const again = maybeRefusal();
    again.response.data.people.push({ ...again.response.data.people[0], entryId: OMAR, fullName: 'Liam Hughes Jr', email: 'jr@members.example' });
    orgService.addMemberListEntry.mockRejectedValueOnce(again);
    fireEvent.click(dialog().getByRole('button', { name: 'Add anyway' }));
    expect(await dialog().findByTestId('maybe-again')).toBeTruthy();
    expect(dialog().getAllByTestId('maybe-match')).toHaveLength(3);
    orgService.addMemberListEntry.mockResolvedValueOnce(written('added', person(ADA, 'Liam Hughes')));
    fireEvent.click(dialog().getByRole('button', { name: 'Add anyway' }));
    await waitFor(() =>
      expect(orgService.addMemberListEntry).toHaveBeenLastCalledWith(GYM, { fullName: 'Liam Hughes', phone: '9876543210', acknowledgedDuplicates: [LIAM, LIAM_PAST, OMAR] }),
    );
    expect(await dialog().findByText('Member added.')).toBeTruthy();
  });

  it('Back to adding goes once staff save a change on the record they opened', async () => {
    const liam = person(LIAM, 'Liam Hughes', { memberNumber: 'GG-0042' });
    orgService.addMemberListEntry.mockRejectedValueOnce(maybeRefusal());
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(liam));
    orgService.changeMemberListEntry.mockResolvedValueOnce(written('changed', { ...liam, phone: '+919876543210' }));
    openBox(null);
    typeLiam();
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    fireEvent.click(within(await dialog().findByTestId('maybe-box')).getAllByRole('button', { name: 'Open' })[0]);
    expect(await dialog().findByTestId('back-to-adding')).toBeTruthy();
    fireEvent.click(await dialog().findByRole('button', { name: 'Edit' }));
    fireEvent.change(dialog().getByLabelText('Phone'), { target: { value: '9876543210' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Save' }));
    expect(await dialog().findByText('Changes saved.')).toBeTruthy();
    expect(dialog().queryByTestId('back-to-adding')).toBeNull();
  });

  it('Open shows that record, and Back to adding brings back every detail typed, sending nothing', async () => {
    orgService.addMemberListEntry.mockRejectedValueOnce(maybeRefusal());
    orgService.getMemberListEntry.mockResolvedValue(entryAnswer(person(LIAM, 'Liam Hughes', { memberNumber: 'GG-0042' })));
    openBox(null);
    typeLiam();
    fireEvent.change(dialog().getByLabelText('Locker'), { target: { value: '12' } });
    fireEvent.click(dialog().getByRole('button', { name: 'Add member' }));
    const box = within(await dialog().findByTestId('maybe-box'));
    fireEvent.click(box.getAllByRole('button', { name: 'Open' })[0]);
    expect(await dialog().findByText('liam@members.example')).toBeTruthy();
    expect(orgService.getMemberListEntry).toHaveBeenCalledWith(GYM, LIAM);
    expect(dialog().queryByTestId('maybe-box')).toBeNull();

    fireEvent.click(dialog().getByRole('button', { name: 'Back to adding Liam Hughes' }));
    expect(dialog().getByRole('heading', { name: 'Add member' })).toBeTruthy();
    expect(dialog().getByLabelText('Name').value).toBe('Liam Hughes');
    expect(dialog().getByLabelText('Phone').value).toBe('9876543210');
    expect(dialog().getByLabelText('Locker').value).toBe('12');
    expect(dialog().queryByTestId('back-to-adding')).toBeNull();
    expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1);
  });
});
