// Quick filters on Your list (V3a-i; spec Part 3 §17.11, board `Members`). The worst thing,
// first: a quick filter, or the Filter, changing who is shown while people are ticked, and the
// bar then acting on somebody who is not ticked. A new list clears the ticks; the bar acts on
// the people ticked on the list shown and nobody else.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntriesPageSchema, memberListViewSchema, memberInvitePreviewSchema } from '@app/shared';

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
      getInvitePreview: vi.fn(),
      getInvitePeople: vi.fn(),
      selectAllMembers: vi.fn(),
      getSelectedInvitePreview: vi.fn(),
      getSelectedInvitePeople: vi.fn(),
      pressInvite: vi.fn(),
      downloadMembersCsv: vi.fn(),
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
  counts: { entries: 312, inApp: 40, canBeInvited: 250, noEmail: 22, former: 4 },
  statuses: [
    { label: 'Active', count: 300, inApp: 40, canBeInvited: 240 },
    { label: 'Cancelled', count: 12, inApp: 0, canBeInvited: 10 },
  ],
  membershipTypes: [
    { label: 'Gold', count: 300, inApp: 40, canBeInvited: 240 },
    { label: '', count: 12, inApp: 0, canBeInvited: 10 },
  ],
  paymentStatuses: [
    { label: 'Paid', count: 280, inApp: 38, canBeInvited: 220 },
    { label: 'Payment due', count: 32, inApp: 2, canBeInvited: 30 },
  ],
  fields: [],
  appWords: [
    { word: 'in_app', count: 40 },
    { word: 'not_in_app', count: 272 },
    { word: 'not_invited', count: 250 },
  ],
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
const pageOf = (entries, total = entries.length) => ({ data: { page: memberListEntriesPageSchema.parse({ total, entries, cursor: null }) } });
/** The server's value for exactly the people a preview would email. */
const SEEN = 'a1'.repeat(32);
const preview = (reach) => ({
  data: {
    preview: memberInvitePreviewSchema.parse({
      version: 3,
      reach,
      skipped: { noEmail: 0, underAge: 0, inApp: 0, alreadyInvited: 0, unsubscribed: 0, bounced: 0, refused: 0, sharedAddress: 0 },
      blocked: null,
      digest: SEEN,
    }),
  },
});

let ada;
let ben;
let cara;

const draw = (props = {}) => render(<MemberListPanel gymId={GYM} gym={GYM_ROW} words={WORDS} readOnly={false} refreshKey={0} {...props} />);
const tickOf = (name) => screen.getByRole('checkbox', { name: `Select ${name}` });
const bar = () => within(screen.getByTestId('sel-bar'));

beforeEach(() => {
  vi.resetAllMocks();
  // jsdom cannot follow a download link; the file handed to it is what the tests check.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  ada = entry('Ada Lovelace');
  ben = entry('Ben Carter');
  cara = entry('Cara Diaz', { status: 'Cancelled' });
  orgService.getMemberList.mockResolvedValue({ data: { list: view } });
  orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben, cara], 312));
  orgService.getInvitePreview.mockResolvedValue(preview(250));
  orgService.getSelectedInvitePeople.mockResolvedValue({ data: { page: { total: 0, people: [], cursor: null } } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});


const quick = () => within(screen.getByTestId('quick-filters'));
const exportTicked = async () => {
  orgService.downloadMembersCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'Selected members.csv' });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
  fireEvent.click(bar().getByTestId('bar-download'));
  await waitFor(() => expect(orgService.downloadMembersCsv).toHaveBeenCalledTimes(1));
  vi.unstubAllGlobals();
};

describe('quick filters', () => {
  it('the worst thing: a quick filter clears the ticks, and the bar then acts only on who is ticked on the new list', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    fireEvent.click(tickOf('Ben Carter'));
    expect(bar().getByTestId('sel-count').textContent).toBe('2 selected');

    // Payment due shows Ben and Cara only; Ada, ticked a moment ago, is not on this list.
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ben, cara], 32));
    fireEvent.click(quick().getByRole('button', { name: /^Payment due/ }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'paymentStatus=Payment+due'));
    await waitFor(() => expect(screen.queryByText('Ada Lovelace')).toBeNull());
    expect(screen.queryByTestId('sel-bar')).toBeNull();
    expect(tickOf('Ben Carter').getAttribute('aria-checked')).toBe('false');

    fireEvent.click(tickOf('Cara Diaz'));
    expect(bar().getByTestId('sel-count').textContent).toBe('1 selected');
    await exportTicked();
    expect(orgService.downloadMembersCsv).toHaveBeenCalledWith(GYM, { kind: 'ticked', entryIds: [cara.entryId] });
  });

  it('Everyone pressed while already showing everyone keeps the ticks: nothing on the list changed', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ben Carter'));
    const everyone = quick().getByRole('button', { name: /^Everyone/ });
    expect(everyone.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(everyone);
    expect(bar().getByTestId('sel-count').textContent).toBe('1 selected');
    await exportTicked();
    expect(orgService.downloadMembersCsv).toHaveBeenCalledWith(GYM, { kind: 'ticked', entryIds: [ben.entryId] });
  });

  it("each shows its server count, asks the server for that kind, and a second press shows everyone again", async () => {
    draw();
    await screen.findByText('Ben Carter');
    expect(quick().getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Everyone 312',
      'Payment due 32',
      'Not in the app 272',
      'Not invited yet 250',
      'No membership 12',
    ]);
    const asked = [
      [/^Not in the app/, 'app=not_in_app'],
      [/^Not invited yet/, 'app=not_invited'],
      [/^No membership/, 'membershipType='],
    ];
    for (const [name, query] of asked) {
      fireEvent.click(quick().getByRole('button', { name }));
      await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, query));
      expect(quick().getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true');
    }
    fireEvent.click(quick().getByRole('button', { name: /^No membership/ }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, ''));
    expect(quick().getByRole('button', { name: /^Everyone/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('with a search typed the quick filters show no counts, and come back with them when it is cleared', async () => {
    draw();
    await screen.findByText('Ben Carter');
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ben], 1));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ben' } });
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'query=ben'));
    await waitFor(() => expect(quick().getAllByRole('button').map((b) => b.textContent)).toEqual(['Everyone', 'Payment due', 'Not in the app', 'Not invited yet', 'No membership']));
    fireEvent.click(quick().getByRole('button', { name: 'Payment due' }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'paymentStatus=Payment+due&query=ben'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    await waitFor(() => expect(quick().getByRole('button', { name: /^Payment due/ }).textContent).toBe('Payment due 32'));
  });

  it('Filter opens from the right, keeps its choices, and Show closes it on them', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const panel = await screen.findByTestId('filter-box');
    expect(panel.className).toContain('c-panel');
    expect(within(panel).getByRole('heading', { name: 'Filter' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: /^Cancelled/ }));
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'status=Cancelled'));
    fireEvent.click(await within(panel).findByRole('button', { name: /^Show 312 members$/ }));
    await waitFor(() => expect(screen.queryByTestId('filter-box')).toBeNull());
    // A choice the quick filters do not have: Everyone is no longer lit, and the Showing line says it.
    expect(quick().getByRole('button', { name: /^Everyone/ }).getAttribute('aria-pressed')).toBe('false');
    expect(within(screen.getByTestId('showing')).getByRole('button', { name: 'Stop showing only Cancelled' })).toBeTruthy();
  });
});
