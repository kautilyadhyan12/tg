// The gym's own list on the Members screen (ROADMAP 5b-i): chips in the gym's own
// words with the server's counts, in the app or not, a search, past members, and rows
// that say where each person stands. A page answered for an older filter is never
// shown under a newer one.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntriesPageSchema, memberListViewSchema, MEMBER_INVITE_EMAIL_REASON_WORDS } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getMemberListEntry: vi.fn(),
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
const names = () => screen.queryAllByTestId('list-row').map((r) => r.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  orgService.getMemberList.mockResolvedValue({ data: { list: view() } });
  orgService.getMemberListEntries.mockResolvedValue(pageOf([entry('Ada Lovelace'), entry('Bea Hart')], 312));
});

afterEach(() => cleanup());

describe("the gym's own list", () => {
  it("shows the gym's own words as chips with the server's counts", async () => {
    draw();
    const status = await screen.findByRole('group', { name: 'Status' });
    expect(within(status).getByRole('button', { name: 'Active 300' })).toBeTruthy();
    expect(within(status).getByRole('button', { name: 'Expired 7' })).toBeTruthy();
    expect(within(status).getByRole('button', { name: 'No status 5' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Membership' })).getByRole('button', { name: 'Gold 12' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Payment' })).toBeNull();
    expect(screen.getByRole('button', { name: 'In the app 40' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not in the app 272' })).toBeTruthy();
    expect((await screen.findByTestId('list-total')).textContent).toBe('312 members');
  });

  it('asks for the ticked words, and "no status" as the people with none', async () => {
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Active 300' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'status=Active'));
    fireEvent.click(screen.getByRole('button', { name: 'No status 5' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'status=Active&status='));
    expect(screen.getByRole('button', { name: 'Active 300' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Not in the app 272' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'filter=not_in_app&status=Active&status='));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, ''));
  });

  it('never shows a page answered for an older filter under a newer one', async () => {
    const whole = later();
    orgService.getMemberListEntries.mockImplementation((_gym, qs) =>
      qs === '' ? whole.promise : Promise.resolve(pageOf([entry('Eve Expired', { status: 'Expired' })], 7)),
    );
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Expired 7' }));
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

  it('shows past members on their own, without the chips that count the list', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: view({ counts: { entries: 312, inApp: 40, canBeInvited: 250, noEmail: 22, former: 4 } }) } });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Past members 4' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'records=former'));
    expect(screen.queryByRole('group', { name: 'Status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'In the app 40' })).toBeNull();
  });

  it('offers no past-members switch to a gym that has none', async () => {
    draw();
    await screen.findByRole('group', { name: 'Status' });
    expect(screen.queryByRole('button', { name: /Past members/ })).toBeNull();
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

  it('greys Add on a gym whose plan has lapsed', async () => {
    draw({ readOnly: true });
    expect((await screen.findByRole('button', { name: 'Add member' })).disabled).toBe(true);
  });
});
