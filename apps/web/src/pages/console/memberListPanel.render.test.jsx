// The gym's own list on the Members screen (ROADMAP 5b-i): Search, Filter, Import and
// Add over the list; Filter holds the gym's own words with the server's counts, in the
// app or not, and past members; what is ticked shows as one "Showing:" line; and rows
// that say where each person stands. A page answered for an older filter is never
// shown under a newer one.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntriesPageSchema, memberListViewSchema, MEMBER_INVITE_EMAIL_REASON_WORDS, MEMBER_LIST_QUERY_MAX_CHARS } from '@app/shared';

// The person's Memberships box (17a-ii) has its own tests in `memberMemberships.render.test.jsx`.
vi.mock('./MemberMemberships', () => ({ default: () => null }));
// Their tags and staff notes (5d) have their own tests in `memberNotes.render.test.jsx`.
vi.mock('./MemberNotes', () => ({ default: () => null }));

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
      getInvitePreview: vi.fn(),
      inviteMemberListEntry: vi.fn(),
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
    appWords: [
      { word: 'in_app', count: 40 },
      { word: 'invited', count: 200 },
      { word: 'not_in_app', count: 72 },
    ],
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
    app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
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

// 5b-v-c's worst thing (spec Part 3 §18.10): staff open one person, then another, and the
// first one's late answer lands on the second one's page, or a button acts on the first.
describe("the worst thing on a person's page: two people opened one after the other", () => {
  const detail = (e) => ({ ...e, extra: [], handEdited: [], members: [] });
  const person = () => within(screen.getByTestId('member-person'));
  const rowOf = async (name) => (await screen.findAllByTestId('list-row')).find((r) => r.textContent.includes(name));

  it('a record whose person also runs the gym is tagged Staff; a member is not (4a-ii)', async () => {
    const mia = entry('Mia Lopez', { inApp: true, staff: { role: 'trainer', roleName: 'Front desk' } });
    const max = entry('Max Hart', { inApp: true, staff: { role: 'manager', roleName: null } });
    const rita = entry('Rita Sen', { inApp: true, staff: null });
    orgService.getMemberListEntries.mockResolvedValue(pageOf([mia, max, rita]));
    draw();
    expect(within(await rowOf('Mia Lopez')).getByTestId('staff-tag').textContent).toBe('Staff · Front desk');
    expect(within(await rowOf('Max Hart')).getByTestId('staff-tag').textContent).toBe('Staff · Manager');
    expect(within(await rowOf('Rita Sen')).queryByTestId('staff-tag')).toBeNull();
  });

  it("Ada's page answering late never shows under Bea's name, and Bea's Invite asks for Bea and invites Bea", async () => {
    const ada = entry('Ada Lovelace');
    const bea = entry('Bea Hart');
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, bea]));
    const adaLate = later();
    orgService.getMemberListEntry.mockImplementation((_gym, id) => (id === ada.entryId ? adaLate.promise : Promise.resolve({ data: { entry: detail(bea) } })));
    orgService.inviteMemberListEntry.mockResolvedValue({ data: { invite: { outcome: 'queued', invitation: null } } });
    draw();
    fireEvent.click(await rowOf('Ada Lovelace'));
    fireEvent.click(person().getByRole('button', { name: 'Close' }));
    fireEvent.click(await rowOf('Bea Hart'));
    expect(await person().findByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
    adaLate.resolve({ data: { entry: detail(ada) } });
    await adaLate.promise;
    await waitFor(() => expect(person().queryByText(/ada@members\.example/)).toBeNull());
    expect(person().getByRole('heading', { name: 'Bea Hart' })).toBeTruthy();

    fireEvent.click(person().getByRole('button', { name: 'Invite to app' }));
    const ask = within(person().getByTestId('confirm-invite'));
    expect(ask.getByText('Invite Bea Hart to the app?')).toBeTruthy();
    expect(ask.getByText('One email goes to bea@members.example with a link to the app.')).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(orgService.inviteMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.inviteMemberListEntry).toHaveBeenCalledWith(GYM, bea.entryId);
  });

  it("Ada's invitation answering after staff moved on to Bea says nothing on Bea's page", async () => {
    const ada = entry('Ada Lovelace');
    const bea = entry('Bea Hart');
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, bea]));
    orgService.getMemberListEntry.mockImplementation((_gym, id) => Promise.resolve({ data: { entry: detail(id === ada.entryId ? ada : bea) } }));
    const invited = later();
    orgService.inviteMemberListEntry.mockReturnValue(invited.promise);
    draw();
    fireEvent.click(await rowOf('Ada Lovelace'));
    fireEvent.click(await person().findByRole('button', { name: 'Invite to app' }));
    fireEvent.click(person().getByRole('button', { name: 'Send invitation' }));
    fireEvent.click(person().getByRole('button', { name: 'Close' }));
    fireEvent.click(await rowOf('Bea Hart'));
    expect(await person().findByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
    const queued = { state: 'queued', invitedAt: '2026-09-28T10:00:00.000Z', email: null, sentAgain: 0, waitingSince: null, notMeAt: null };
    invited.resolve({ data: { invite: { outcome: 'queued', invitation: queued } } });
    await invited.promise;
    // Ada's invitation was sent for Ada, and Bea's page is untouched by it.
    expect(orgService.inviteMemberListEntry).toHaveBeenCalledWith(GYM, ada.entryId);
    await waitFor(() => expect(person().queryByRole('status')).toBeNull());
    expect(person().queryByText(/Invitation sent/)).toBeNull();
    expect(person().getByText('Not in the app')).toBeTruthy();
    expect(person().getByRole('button', { name: 'Invite to app' })).toBeTruthy();
  });
});

describe("the gym's own list", () => {
  it('shows Search, Filter and the count over the list, and no chips until Filter is pressed', async () => {
    draw();
    expect((await screen.findByTestId('list-total')).textContent).toBe('312 members');
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search your members by name, email, phone or member number' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Active 300' })).toBeNull();
    expect(screen.queryByTestId('showing')).toBeNull();
    // Import and Add member sit in the page's header, not over the list.
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  });

  it("opens Import or Add member when the page's header asks, and says it was taken", async () => {
    const taken = vi.fn();
    const { rerender } = draw({ action: 'import', onActionTaken: taken });
    expect(await screen.findByTestId('member-import')).toBeTruthy();
    expect(taken).toHaveBeenCalledTimes(1);
    rerender(<MemberListPanel gymId={GYM} words={WORDS} readOnly={false} refreshKey={0} action="add" onActionTaken={taken} />);
    expect(await screen.findByRole('dialog', { name: 'Add member' })).toBeTruthy();
    expect(taken).toHaveBeenCalledTimes(2);
  });

  it("holds the gym's own words in the Filter box, with the server's counts", async () => {
    draw();
    await openFilter();
    const status = filterBox().getByRole('group', { name: 'Status' });
    expect(within(status).getByRole('button', { name: 'Active 300' })).toBeTruthy();
    expect(within(status).getByRole('button', { name: 'Expired 7' })).toBeTruthy();
    expect(within(status).getByRole('button', { name: 'No status 5' })).toBeTruthy();
    expect(within(filterBox().getByRole('group', { name: 'Membership' })).getByRole('button', { name: 'Gold 12' })).toBeTruthy();
    expect(filterBox().queryByRole('group', { name: 'Payment status' })).toBeNull();
    const app = within(filterBox().getByRole('group', { name: 'App' }));
    expect(app.getAllByRole('button').map((b) => b.textContent)).toEqual(['In the app 40', 'Invited 200', 'Not in the app 72']);
    // Show holds no Past members for a gym that has none, so the box starts at App.
    expect(filterBox().queryByRole('radiogroup', { name: 'Show' })).toBeNull();
  });

  it('asks for the ticked words, and "no status" as the people with none, then shows them on one line', async () => {
    draw();
    await openFilter();
    fireEvent.click(filterBox().getByRole('button', { name: 'Active 300' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'status=Active'));
    fireEvent.click(filterBox().getByRole('button', { name: 'No status 5' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'status=Active&status='));
    fireEvent.click(filterBox().getByRole('button', { name: 'Not in the app 72' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'app=not_in_app&status=Active&status='));
    expect(filterBox().getByRole('button', { name: 'Active 300' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(await filterBox().findByRole('button', { name: /^Show \d+ members?$/ }));
    expect(screen.queryByRole('dialog', { name: 'Filter' })).toBeNull();
    const showing = screen.getByTestId('showing');
    expect(within(showing).getAllByRole('button').map((b) => b.textContent)).toEqual(['Active', 'No status', 'Not in the app', 'Clear']);
    expect(screen.getByRole('button', { name: 'Filter · 3' })).toBeTruthy();

    // A pill takes off only itself.
    fireEvent.click(within(showing).getByRole('button', { name: 'Stop showing only No status' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'app=not_in_app&status=Active'));
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
    fireEvent.change(screen.getByLabelText('Search your members by name, email, phone or member number'), { target: { value: 'ada' } });
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'query=ada'));
  });

  it('shows past members on their own, without the words that count the list', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: view({ counts: { entries: 312, inApp: 40, canBeInvited: 250, noEmail: 22, former: 4 } }) } });
    draw();
    await openFilter();
    const show = within(filterBox().getByRole('radiogroup', { name: 'Show' }));
    expect(show.getByRole('radio', { name: 'Members 312' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(show.getByRole('radio', { name: 'Past members 4' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'records=former'));
    expect(show.getByRole('radio', { name: 'Past members 4' }).getAttribute('aria-checked')).toBe('true');
    expect(filterBox().queryByRole('group', { name: 'Status' })).toBeNull();
    expect(filterBox().queryByRole('group', { name: 'App' })).toBeNull();
    fireEvent.click(filterBox().getByRole('button', { name: 'Close' }));
    expect(within(screen.getByTestId('showing')).getByRole('button', { name: 'Stop showing only Past members' })).toBeTruthy();
  });

  it('offers no past-members choice to a gym that has none', async () => {
    draw();
    await openFilter();
    expect(filterBox().queryByRole('button', { name: /Past members/ })).toBeNull();
  });

  it("prints each row's App word as the server sent it, a line to check under the whole row", async () => {
    const app = (over) => ({ at: null, line: null, lineTone: 'plain', ...over });
    orgService.getMemberListEntries.mockResolvedValue(
      pageOf([
        entry('Ada Lovelace', { inApp: true, app: app({ word: 'in_app', tone: 'green' }) }),
        entry('Bea Hart', {
          app: app({ word: 'not_in_app', tone: 'grey', line: MEMBER_INVITE_EMAIL_REASON_WORDS.shared_address, lineTone: 'amber' }),
        }),
        entry('Cy No Email', { email: null, phone: '+447700900123', app: app({ word: 'not_in_app', tone: 'grey', line: 'No email address' }) }),
        entry('Maria Park', { app: app({ word: 'in_app', tone: 'green', line: 'Maria Park and Leo Park use the app with these details.', lineTone: 'amber' }) }),
      ]),
    );
    draw();
    const rows = await screen.findAllByTestId('list-row');
    expect(rows[0].textContent).toContain('In the app');
    // One tag per row, as Leads: a ⚠ on the tag itself when something needs checking,
    // the sentence on hover and to a screen reader (and on the person's page).
    expect(within(rows[0]).queryByTestId('needs-check')).toBeNull();
    expect(rows[1].textContent).toContain('Not in the app');
    expect(within(rows[1]).getByTestId('needs-check').getAttribute('title')).toBe(MEMBER_INVITE_EMAIL_REASON_WORDS.shared_address);
    expect(within(rows[1]).getByTestId('needs-check').className).toContain('c-tag-warn');
    expect(rows[1].textContent).not.toContain(MEMBER_INVITE_EMAIL_REASON_WORDS.shared_address);
    expect(rows[2].textContent).toContain('+447700900123');
    expect(rows[2].textContent).toContain('Not in the app');
    // A line that only explains is on the person's own page, not on the list.
    expect(rows[2].textContent).not.toContain('No email address');
    expect(within(rows[2]).queryByTestId('needs-check')).toBeNull();
    expect(within(rows[3]).getByTestId('needs-check').getAttribute('aria-label')).toBe(
      'In the app. Needs attention: Maria Park and Leo Park use the app with these details.',
    );
  });

  // THE WORST THING (5b-v-a-i): a row saying something false about a person with the app.
  // The server decides the word once for everybody (§18.4); a screen that worked out its
  // own from `inApp` or the address's invitation would put the mother's "In the app" or
  // "Invited" on her son's row.
  it("prints the server's App word on every row and never one of its own, whatever else the row carries", async () => {
    const app = (over) => ({ at: null, line: null, lineTone: 'plain', ...over });
    const accepted = { state: 'accepted', invitedAt: '2026-09-20T10:00:00.000Z', email: null, sentAgain: 0, waitingSince: null, notMeAt: null };
    orgService.getMemberListEntries.mockResolvedValue(
      pageOf([
        // The son: the address's invitation is his mother's, and the server says so.
        entry('Leo Park', { invitation: accepted, app: app({ word: 'not_in_app', tone: 'grey', line: 'Maria Park uses the app with this email.' }) }),
        // A row the old tick called "in the app" that the server does not.
        entry('Olu Ade', { inApp: true, app: app({ word: 'not_in_app', tone: 'grey', line: 'Removed from app', at: '2026-09-26T09:30:00.000Z' }) }),
      ]),
    );
    draw();
    const rows = await screen.findAllByTestId('list-row');
    expect(rows[0].textContent).toContain('Not in the app');
    expect(rows[0].textContent).not.toMatch(/In the app|Left the app|Invited/);
    expect(rows[1].textContent).toContain('Not in the app');
    expect(rows[1].textContent).not.toContain('In the app');
  });

  it("offers 'Check these' only when somebody needs checking, and See who shows them", async () => {
    draw();
    await screen.findAllByTestId('list-row');
    expect(screen.queryByTestId('check-these')).toBeNull();
    cleanup();
    orgService.getMemberList.mockResolvedValue({ data: { list: view({ appWords: [{ word: 'in_app', count: 40 }, { word: 'needs_check', count: 2 }] }) } });
    draw();
    const box = await screen.findByTestId('check-these');
    expect(box.textContent).toBe('2 need attention');
    fireEvent.click(box);
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'app=needs_check'));
    expect(within(screen.getByTestId('showing')).getByRole('button', { name: 'Stop showing only Needs attention' })).toBeTruthy();
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
    draw({ emptyExtra: <p>Already in the app · 3</p> });
    expect(await screen.findByRole('heading', { name: 'Your list is empty' })).toBeTruthy();
    expect(screen.getByText('Already in the app · 3')).toBeTruthy();
    expect(screen.queryByTestId('list-total')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Import members' }));
    expect(await screen.findByTestId('member-import')).toBeTruthy();
  });

  it('says a failed read failed, never that the list is empty, and reads again', async () => {
    orgService.getMemberListEntries.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500, data: {} } }));
    draw();
    expect(await screen.findByText("We couldn't load your list.")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your list is empty' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Ada Lovelace/)).toBeTruthy();
  });

  it("greys an empty list's Import and Add on a gym whose plan has lapsed", async () => {
    orgService.getMemberList.mockResolvedValue({
      data: { list: view({ hasList: false, counts: { entries: 0, inApp: 0, canBeInvited: 0, noEmail: 0, former: 0 }, statuses: [], membershipTypes: [] }) },
    });
    orgService.getMemberListEntries.mockResolvedValue(pageOf([]));
    draw({ readOnly: true });
    expect((await screen.findByRole('button', { name: 'Add member' })).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Import members' }).disabled).toBe(true);
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
    expect((await screen.findByLabelText('Search your members by name, email, phone or member number')).getAttribute('maxLength')).toBe(String(MEMBER_LIST_QUERY_MAX_CHARS));
  });

  it('L4: the re-read after a change walks at most five pages, and leaves Load more for the rest', async () => {
    const people = Array.from({ length: 7 }, (_, i) => entry(`Person ${String(i)}`));
    orgService.getMemberListEntries.mockImplementation((_gym, qs) => {
      const at = qs === '' ? 0 : Number(qs.replace('cursor=p', ''));
      return Promise.resolve(pageOf([people[at]], 7, at < 6 ? `p${String(at + 1)}` : null));
    });
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: { ...people[0], extra: [], handEdited: [], members: [] } } });
    orgService.changeMemberListEntry.mockResolvedValue({ data: { outcome: 'changed', entry: { ...people[0], extra: [], handEdited: [], members: [] }, version: 2 } });
    draw();
    for (let i = 1; i <= 6; i += 1) {
      fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
      await waitFor(() => expect(names()).toHaveLength(i + 1));
    }
    const before = orgService.getMemberListEntries.mock.calls.length;
    fireEvent.click(screen.getAllByTestId('list-row')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+447700900555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(names()).toHaveLength(5));
    expect(orgService.getMemberListEntries.mock.calls.length - before).toBe(5);
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });
});
describe('the Invite button', () => {
  const preview = (reach) => ({ data: { preview: { version: 3, reach, skipped: { noEmail: 0, underAge: 0, inApp: 0, alreadyInvited: 0, unsubscribed: 0, bounced: 0, refused: 0, sharedAddress: 0 }, blocked: null } } });

  it("reads Invite to app, and asks the box's number again for the gym's own words but not for a search", async () => {
    orgService.getInvitePreview.mockResolvedValue(preview(214));
    draw();
    expect((await screen.findByTestId('invite-button')).textContent).toBe('Invite to app');
    await waitFor(() => expect(orgService.getInvitePreview).toHaveBeenLastCalledWith(GYM, ''));

    orgService.getInvitePreview.mockResolvedValue(preview(1));
    await openFilter();
    fireEvent.click(filterBox().getByRole('button', { name: 'Active 300' }));
    await waitFor(() => expect(orgService.getInvitePreview).toHaveBeenLastCalledWith(GYM, 'status=Active'));
    expect(screen.getByTestId('invite-button').textContent).toBe('Invite to app');
    const asked = orgService.getInvitePreview.mock.calls.length;

    fireEvent.click(filterBox().getByRole('button', { name: 'Close' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your members by name, email, phone or member number' }), { target: { value: 'ada' } });
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'status=Active&query=ada'));
    expect(orgService.getInvitePreview.mock.calls.length).toBe(asked);
  });

  it('is not offered on past members', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: view({ counts: { entries: 312, inApp: 40, canBeInvited: 250, noEmail: 22, former: 4 } }) } });
    orgService.getInvitePreview.mockResolvedValue(preview(2));
    draw();
    await screen.findByTestId('invite-button');
    await openFilter();
    fireEvent.click(filterBox().getByRole('radio', { name: 'Past members 4' }));
    await waitFor(() => expect(screen.queryByTestId('invite-button')).toBeNull());
  });
});
// 23a-i: somebody given a membership in the app read as having none on the list.
describe('a row says what the person holds in the app (23a-i)', () => {
  const rowOf = async (name) => (await screen.findAllByTestId('list-row')).find((r) => r.textContent.includes(name));

  it("shows the membership, its day and what is owed, and never the record's own word beside it", async () => {
    // Maya's record still says "Paid" from the gym's old file; she owes on a pack she holds.
    const maya = entry('Maya Lopez', {
      status: 'Expired',
      membershipType: 'Gold',
      paymentStatus: 'Paid',
      held: { status: 'active', memberships: ['Gold Monthly', 'PT 10'], day: { what: 'renews', on: '2099-11-06' }, payment: { state: 'due', since: '2026-10-01' } },
    });
    const leo = entry('Leo Grant', { held: { status: 'active', memberships: ['Gold Monthly'], day: { what: 'renews', on: '2099-11-06' }, payment: { state: 'paid' } } });
    const dev = entry('Dev Shah', { status: null, held: { status: 'cancelled', memberships: ['Gold Monthly'], day: { what: 'cancelled', on: '2026-09-03' }, payment: null } });
    const asha = entry('Asha Patel', { status: 'Active', membershipType: 'Bronze', paymentStatus: 'Paid' });
    // Uma's membership starts later and is not paid: nothing is owed before its day.
    const uma = entry('Uma Costa', { held: { status: 'upcoming', memberships: ['Gold Monthly'], day: { what: 'starts', on: '2099-10-17' }, payment: { state: 'later', on: '2099-10-17' } } });
    orgService.getMemberListEntries.mockResolvedValue(pageOf([maya, leo, dev, asha, uma]));
    draw();

    const mayaRow = await rowOf('Maya Lopez');
    expect(mayaRow.textContent).toContain('Gold Monthly +1');
    expect(mayaRow.textContent).toContain('Renews 6 Nov 2099');
    expect(mayaRow.textContent).not.toContain('Expired');
    const owed = within(mayaRow).getByTestId('row-pay');
    expect(owed.textContent).toBe('Payment due');
    expect(owed.style.color).toBe('var(--warn)');

    const paid = within(await rowOf('Leo Grant')).getByTestId('row-pay');
    expect(paid.textContent).toBe('Paid');
    expect(paid.style.color).toBe('');

    const umaRow = await rowOf('Uma Costa');
    expect(umaRow.textContent).toContain('Not started');
    expect(umaRow.textContent).toContain('Starts 17 Oct 2099');
    const notYet = within(umaRow).getByTestId('row-pay');
    expect(notYet.textContent).toBe('Not due yet');
    expect(notYet.style.color).toBe('');

    const devRow = await rowOf('Dev Shah');
    expect(devRow.textContent).toContain('Cancelled');
    expect(within(devRow).getByTestId('row-pay').textContent).toBe('—');

    // Nothing held here: the gym's own words, as before.
    const ashaRow = await rowOf('Asha Patel');
    expect(ashaRow.textContent).toContain('Bronze');
    expect(within(ashaRow).getByTestId('row-pay').textContent).toBe('Paid');
  });
});
