// The gym's own list on the Members screen (ROADMAP 5b-i): Search, Filter, Import and
// Add over the list; Filter holds the gym's own words with the server's counts, in the
// app or not, and past members; what is ticked shows as one "Showing:" line; and rows
// that say where each person stands. A page answered for an older filter is never
// shown under a newer one.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntriesPageSchema, memberListViewSchema, MEMBER_INVITE_EMAIL_REASON_WORDS, MEMBER_LIST_QUERY_MAX_CHARS } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getMemberListEntry: vi.fn(),
      uploadMemberList: vi.fn(),
      changeMemberListEntry: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListPanel = (await import('./MemberListPanel')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members' };

const view = (over = {}) =>
  memberListViewSchema.parse({
    hasList: true,
    version: 3,
    lastConfirmedAt: '2026-09-20T10:00:00.000Z',
    counts: { entries: 312, inApp: 40, canBeInvited: 250, noEmail: 22, former: 0 },
    statuses: [
      { label: 'Active', count: 300, inApp: 40, canBeInvited: 240 },
      { label: 'Expired', count: 7, inApp: 0, canBeInvited: 7 },
      { label: '', count: 5, inApp: 0, canBeInvited: 3 },
    ],
    membershipTypes: [{ label: 'Gold', count: 12, inApp: 3, canBeInvited: 9 }],
    paymentStatuses: [],
    fields: [],
    ...over,
  });

let n = 0;
const entry = (fullName, over = {}) => {
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
    ...over,
  };
};
const pageOf = (entries, total = entries.length, cursor = null) => ({
  data: { page: memberListEntriesPageSchema.parse({ total, entries, cursor }) },
});

function later() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const draw = (props = {}) => render(<MemberListPanel gymId={GYM} words={WORDS} readOnly={false} refreshKey={0} {...props} />);
/** Open the Filter box. */
const openFilter = async () => fireEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
const filterBox = () => within(screen.getByRole('dialog', { name: 'Filter' }));
const names = () => screen.queryAllByTestId('list-row').map((r) => r.textContent);

beforeEach(() => {
  // Reset, not clear: a queued answer a failed test never used must not reach the next test.
  vi.resetAllMocks();
  orgService.getMemberList.mockResolvedValue({ data: { list: view() } });
  orgService.getMemberListEntries.mockResolvedValue(pageOf([entry('Ada Lovelace'), entry('Bea Hart')], 312));
});

afterEach(() => cleanup());

describe("the gym's own list", () => {
  it('shows Search, Filter, Import and Add over the list, and no chips until Filter is pressed', async () => {
    draw();
    expect((await screen.findByTestId('list-total')).textContent).toBe('312 members');
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add member' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Active 300' })).toBeNull();
    expect(screen.queryByTestId('showing')).toBeNull();
  });

  it("holds the gym's own words in the Filter box, with the server's counts", async () => {
    draw();
    await openFilter();
    const status = filterBox().getByRole('group', { name: 'Status' });
    expect(within(status).getByRole('button', { name: 'Active 300' })).toBeTruthy();
    expect(within(status).getByRole('button', { name: 'Expired 7' })).toBeTruthy();
    expect(within(status).getByRole('button', { name: 'No status 5' })).toBeTruthy();
    expect(within(filterBox().getByRole('group', { name: 'Membership' })).getByRole('button', { name: 'Gold 12' })).toBeTruthy();
    expect(filterBox().queryByRole('group', { name: 'Payment' })).toBeNull();
    expect(filterBox().getByRole('button', { name: 'In the app 40' })).toBeTruthy();
    expect(filterBox().getByRole('button', { name: 'Not in the app 272' })).toBeTruthy();
  });

  it('asks for the ticked words, and "no status" as the people with none, then shows them on one line', async () => {
    draw();
    await openFilter();
    fireEvent.click(filterBox().getByRole('button', { name: 'Active 300' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'status=Active'));
    fireEvent.click(filterBox().getByRole('button', { name: 'No status 5' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'status=Active&status='));
    fireEvent.click(filterBox().getByRole('button', { name: 'Not in the app 272' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'filter=not_in_app&status=Active&status='));
    expect(filterBox().getByRole('button', { name: 'Active 300' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(await filterBox().findByRole('button', { name: /^Show \d+ members?$/ }));
    expect(screen.queryByRole('dialog', { name: 'Filter' })).toBeNull();
    const showing = screen.getByTestId('showing');
    expect(within(showing).getAllByRole('button').map((b) => b.textContent)).toEqual(['Active', 'No status', 'Not in the app', 'Clear']);
    expect(screen.getByRole('button', { name: 'Filter · 3' })).toBeTruthy();

    // A pill takes off only itself.
    fireEvent.click(within(showing).getByRole('button', { name: 'Stop showing only No status' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'filter=not_in_app&status=Active'));
    fireEvent.click(within(screen.getByTestId('showing')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, ''));
    expect(screen.queryByTestId('showing')).toBeNull();
  });

  it('never shows a page answered for an older filter under a newer one', async () => {
    const whole = later();
    orgService.getMemberListEntries.mockImplementation((_gym, qs) =>
      qs === '' ? whole.promise : Promise.resolve(pageOf([entry('Eve Expired', { status: 'Expired' })], 7)),
    );
    draw();
    await openFilter();
    fireEvent.click(filterBox().getByRole('button', { name: 'Expired 7' }));
    await waitFor(() => expect(names().some((t) => t.includes('Eve Expired'))).toBe(true));
    whole.resolve(pageOf([entry('Ada Lovelace')], 312));
    await new Promise((r) => setTimeout(r, 0));
    expect(names().some((t) => t.includes('Ada Lovelace'))).toBe(false);
    expect(screen.getByTestId('list-total').textContent).toBe('7 members match');
  });

  it('searches once typing pauses', async () => {
    draw();
    await screen.findAllByTestId('list-row');
    fireEvent.change(screen.getByLabelText('Search your members'), { target: { value: 'ada' } });
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'query=ada'));
  });

  it('shows past members on their own, without the words that count the list', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: view({ counts: { entries: 312, inApp: 40, canBeInvited: 250, noEmail: 22, former: 4 } }) } });
    draw();
    await openFilter();
    fireEvent.click(filterBox().getByRole('button', { name: 'Past members 4' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'records=former'));
    expect(filterBox().queryByRole('group', { name: 'Status' })).toBeNull();
    expect(filterBox().queryByRole('button', { name: 'In the app 40' })).toBeNull();
    fireEvent.click(filterBox().getByRole('button', { name: 'Close' }));
    expect(within(screen.getByTestId('showing')).getByRole('button', { name: 'Stop showing only Past members' })).toBeTruthy();
  });

  it('offers no past-members choice to a gym that has none', async () => {
    draw();
    await openFilter();
    expect(filterBox().queryByRole('button', { name: /Past members/ })).toBeNull();
  });

  it("says where each person stands, with the server's reason for an email that did not go", async () => {
    orgService.getMemberListEntries.mockResolvedValue(
      pageOf([
        entry('Ada Lovelace', { inApp: true }),
        entry('Bea Hart', {
          invitation: {
            state: 'pending',
            invitedAt: '2026-09-20T10:00:00.000Z',
            email: { state: 'skipped', reason: 'shared_address', at: '2026-09-20T10:01:00.000Z', result: null },
            sentAgain: 0,
            waitingSince: null,
            notMeAt: null,
          },
        }),
        entry('Cy No Email', { email: null, phone: '+447700900123' }),
      ]),
    );
    draw();
    const rows = await screen.findAllByTestId('list-row');
    expect(rows[0].textContent).toContain('Uses the app');
    expect(rows[1].textContent).toContain('Invited · email not sent');
    expect(rows[1].textContent).toContain(MEMBER_INVITE_EMAIL_REASON_WORDS.shared_address);
    expect(rows[2].textContent).toContain('+447700900123');
    expect(rows[2].textContent).toContain('No email');
  });

  it('loads the next hundred with the cursor and adds them below', async () => {
    orgService.getMemberListEntries
      .mockResolvedValueOnce(pageOf([entry('Ada Lovelace')], 2, 'next-1'))
      .mockResolvedValueOnce(pageOf([entry('Bea Hart')], 2, null));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(names()).toHaveLength(2));
    expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'cursor=next-1');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('opens the import box from the Import button', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
    expect(await screen.findByTestId('member-import')).toBeTruthy();
  });

  it('says the list is empty, and how to fill it, for a gym with no list', async () => {
    orgService.getMemberList.mockResolvedValue({
      data: { list: view({ hasList: false, counts: { entries: 0, inApp: 0, canBeInvited: 0, noEmail: 0, former: 0 }, statuses: [], membershipTypes: [] }) },
    });
    orgService.getMemberListEntries.mockResolvedValue(pageOf([]));
    draw();
    expect(await screen.findByText('Your list is empty.')).toBeTruthy();
    expect(screen.queryByTestId('list-total')).toBeNull();
  });

  it('says a failed read failed, never that the list is empty, and reads again', async () => {
    orgService.getMemberListEntries.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500, data: {} } }));
    draw();
    expect(await screen.findByText("We couldn't load your list.")).toBeTruthy();
    expect(screen.queryByText('Your list is empty.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Ada Lovelace/)).toBeTruthy();
  });

  it('greys Import and Add on a gym whose plan has lapsed', async () => {
    draw({ readOnly: true });
    expect((await screen.findByRole('button', { name: 'Add member' })).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Import' }).disabled).toBe(true);
  });
});

describe('round one: after a change', () => {
  const detail = (e) => ({ ...e, extra: [], handEdited: [], members: [] });

  it('H2: a change on the list tells the Members screen, so "Using the app" is read again', async () => {
    const ada = entry('Ada Lovelace');
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada]));
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: detail(ada) } });
    orgService.changeMemberListEntry.mockResolvedValue({ data: { outcome: 'changed', entry: detail({ ...ada, phone: '+447700900555' }), version: 2 } });
    const onRosterChanged = vi.fn();
    draw({ onRosterChanged });
    fireEvent.click(await screen.findByTestId('list-row'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+447700900555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onRosterChanged).toHaveBeenCalledTimes(1));
  });

  it('L3: a change keeps the pages already loaded, so staff keep their place', async () => {
    const ada = entry('Ada Lovelace');
    const bea = entry('Bea Hart');
    orgService.getMemberListEntries.mockImplementation((_gym, qs) =>
      Promise.resolve(qs === 'cursor=next-1' ? pageOf([bea], 2, null) : pageOf([ada], 2, 'next-1')),
    );
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: detail(bea) } });
    orgService.changeMemberListEntry.mockResolvedValue({ data: { outcome: 'changed', entry: detail(bea), version: 2 } });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(names()).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('list-row')[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+447700900555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.changeMemberListEntry).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(orgService.getMemberListEntries.mock.calls.length).toBe(4));
    await waitFor(() => expect(names()).toHaveLength(2));
    expect(names()[1]).toContain('Bea Hart');
  });

  it('L1: the search takes no more than the server reads', async () => {
    draw();
    expect((await screen.findByLabelText('Search your members')).getAttribute('maxLength')).toBe(String(MEMBER_LIST_QUERY_MAX_CHARS));
  });
});