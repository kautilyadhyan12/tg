// Selecting people on the Members list (spec Part 3 §18.5; ROADMAP 5b-v-b-i): a tick box
// on every row and on the heading, "Select all 312 members", and a bar — "3 selected ·
// Invite to app · Download CSV · Clear" — that acts on the people selected and nobody
// else. The worst thing, first: Invite from the bar reaching someone who was not ticked.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntriesPageSchema, memberListViewSchema, memberInvitePreviewSchema } from '@app/shared';

// The person's Memberships box (17a-ii) has its own tests in `memberMemberships.render.test.jsx`.
vi.mock('./MemberMemberships', () => ({ default: () => null }));

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
const DIGEST = 'a'.repeat(64);

const view = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 312, inApp: 40, canBeInvited: 250, noEmail: 22, former: 4 },
  statuses: [
    { label: 'Active', count: 300, inApp: 40, canBeInvited: 240 },
    { label: 'Cancelled', count: 12, inApp: 0, canBeInvited: 10 },
  ],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [],
  appWords: [{ word: 'not_in_app', count: 312 }],
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

describe('selecting people', () => {
  it('the worst thing: Invite from the bar asks about, and sends to, only the one person ticked', async () => {
    draw();
    await screen.findByText('Ben Carter');
    // Nothing ticked: no bar, and the toolbar's Invite for the Filter's words is there.
    expect(screen.queryByTestId('sel-bar')).toBeNull();
    expect(screen.getByTestId('invite-button')).toBeTruthy();

    fireEvent.click(tickOf('Ben Carter'));
    expect(bar().getByTestId('sel-count').textContent).toBe('1 selected');
    // A tick selects; it never opens the person.
    expect(screen.queryByRole('dialog')).toBeNull();

    orgService.getSelectedInvitePreview.mockResolvedValue(preview(1));
    orgService.pressInvite.mockResolvedValue({
      data: { invited: { queued: 1, skipped: preview(0).data.preview.skipped, version: 3 } },
    });
    fireEvent.click(bar().getByTestId('bar-invite'));
    const box = within(await screen.findByTestId('invite-box'));
    expect((await box.findByTestId('invite-summary')).textContent).toBe('1 selected member will receive an invitation email');
    const ticked = { kind: 'ticked', entryIds: [ben.entryId] };
    expect(orgService.getSelectedInvitePreview).toHaveBeenCalledWith(GYM, ticked);
    expect(orgService.getSelectedInvitePeople).toHaveBeenCalledWith(GYM, ticked, 'reach');
    expect(orgService.getInvitePeople).not.toHaveBeenCalled();

    fireEvent.click(box.getByRole('checkbox', { name: /I have permission to email them/ }));
    fireEvent.click(box.getByRole('button', { name: 'Send 1 invitation' }));
    await waitFor(() => expect(orgService.pressInvite).toHaveBeenCalledTimes(1));
    expect(orgService.pressInvite).toHaveBeenCalledWith(GYM, { selection: ticked, version: 3, expectedCount: 1, expectedDigest: SEEN, permissionConfirmed: true });
  });

  it('the heading ticks the page, then "Select all 312 members" selects everyone the list shows, and Download sends that', async () => {
    draw();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every member on this page' }));
    expect(bar().getByTestId('sel-count').textContent).toBe('3 selected');
    for (const name of ['Ada Lovelace', 'Ben Carter', 'Cara Diaz']) expect(tickOf(name).getAttribute('aria-checked')).toBe('true');
    const line = screen.getByTestId('select-line');
    expect(line.textContent).toContain('All 3 members on this page are selected.');

    orgService.selectAllMembers.mockResolvedValue({ data: { selection: { count: 312, digest: DIGEST } } });
    fireEvent.click(within(line).getByRole('button', { name: 'Select all 312 members' }));
    await waitFor(() => expect(bar().getByTestId('sel-count').textContent).toBe('312 selected'));
    expect(orgService.selectAllMembers).toHaveBeenCalledWith(GYM, {});
    expect(screen.getByTestId('select-line').textContent).toContain('All 312 members are selected.');

    const createObjectURL = vi.fn(() => 'blob:members');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    orgService.downloadMembersCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'All members 2026-09-28.csv' });
    fireEvent.click(bar().getByTestId('bar-download'));
    await waitFor(() => expect(orgService.downloadMembersCsv).toHaveBeenCalledTimes(1));
    expect(orgService.downloadMembersCsv).toHaveBeenCalledWith(GYM, { kind: 'all', filter: {}, count: 312, digest: DIGEST });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it('unticking one person after Select all leaves the rest of the rows shown ticked, not everyone', async () => {
    draw();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every member on this page' }));
    orgService.selectAllMembers.mockResolvedValue({ data: { selection: { count: 312, digest: DIGEST } } });
    fireEvent.click(within(screen.getByTestId('select-line')).getByRole('button', { name: 'Select all 312 members' }));
    await waitFor(() => expect(bar().getByTestId('sel-count').textContent).toBe('312 selected'));
    fireEvent.click(tickOf('Ben Carter'));
    expect(bar().getByTestId('sel-count').textContent).toBe('2 selected');
    orgService.downloadMembersCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'Selected members.csv' });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    fireEvent.click(bar().getByTestId('bar-download'));
    await waitFor(() => expect(orgService.downloadMembersCsv).toHaveBeenCalledTimes(1));
    expect(orgService.downloadMembersCsv).toHaveBeenCalledWith(GYM, { kind: 'ticked', entryIds: [ada.entryId, cara.entryId] });
    vi.unstubAllGlobals();
  });

  it('a search clears the selection: the people ticked were chosen from another list', async () => {
    draw();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(tickOf('Ada Lovelace'));
    expect(screen.getByTestId('sel-bar')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ben' } });
    await waitFor(() => expect(screen.queryByTestId('sel-bar')).toBeNull(), { timeout: 2000 });
  });

  it('a Select all whose people changed downloads nothing and says how many are selected now', async () => {
    draw();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every member on this page' }));
    orgService.selectAllMembers.mockResolvedValue({ data: { selection: { count: 312, digest: DIGEST } } });
    fireEvent.click(within(screen.getByTestId('select-line')).getByRole('button', { name: 'Select all 312 members' }));
    await waitFor(() => expect(bar().getByTestId('sel-count').textContent).toBe('312 selected'));
    const body = { error: 'selection_changed', message: 'changed', count: 314, digest: 'b'.repeat(64) };
    orgService.downloadMembersCsv.mockRejectedValue({ response: { status: 409, data: new Blob([JSON.stringify(body)], { type: 'application/json' }) } });
    fireEvent.click(bar().getByTestId('bar-download'));
    expect((await screen.findByTestId('selection-note')).textContent).toBe(
      'The members you selected have changed, so nothing was downloaded. 314 are selected now.',
    );
    expect(bar().getByTestId('sel-count').textContent).toBe('314 selected');
  });

  it('a read-only gym and past members get Download CSV only in the bar', async () => {
    draw({ readOnly: true });
    await screen.findByText('Ada Lovelace');
    fireEvent.click(tickOf('Ada Lovelace'));
    expect(bar().queryByTestId('bar-invite')).toBeNull();
    expect(bar().getByTestId('bar-download')).toBeTruthy();
    cleanup();

    orgService.getMemberListEntries.mockResolvedValue(pageOf([entry('Rae Past', { formerAt: '2026-09-01T10:00:00.000Z' })], 1));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('radio', { name: /Past members/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('button', { name: /^Show/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Rae Past' }));
    expect(bar().queryByTestId('bar-invite')).toBeNull();
    expect(bar().getByTestId('bar-download')).toBeTruthy();
  });

  it('with nobody ticked, Download CSV above the list downloads everyone the list shows; with people ticked it gives way to the bar', async () => {
    draw();
    await screen.findByText('Ada Lovelace');
    orgService.selectAllMembers.mockResolvedValue({ data: { selection: { count: 312, digest: DIGEST } } });
    orgService.downloadMembersCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'All members 2026-09-28.csv' });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    fireEvent.click(screen.getByTestId('download-shown'));
    await waitFor(() => expect(orgService.downloadMembersCsv).toHaveBeenCalledTimes(1));
    expect(orgService.selectAllMembers).toHaveBeenCalledWith(GYM, {});
    expect(orgService.downloadMembersCsv).toHaveBeenCalledWith(GYM, { kind: 'all', filter: {}, count: 312, digest: DIGEST });
    vi.unstubAllGlobals();

    fireEvent.click(tickOf('Ada Lovelace'));
    expect(screen.queryByTestId('download-shown')).toBeNull();
    expect(bar().getByTestId('bar-download')).toBeTruthy();
  });

  it('the Invite page holds the list behind it still while it is open, and lets it scroll again after', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ben Carter'));
    orgService.getSelectedInvitePreview.mockResolvedValue(preview(1));
    fireEvent.click(bar().getByTestId('bar-invite'));
    await screen.findByTestId('invite-box');
    expect(document.body.style.overflow).toBe('hidden');
    // Its own middle scrolls: allowed to shrink below its content, and not itself a column,
    // which would shrink the table to fit and cut its last rows off instead (jsdom has no
    // layout; this was seen in Edge with 35 people).
    const scroller = screen.getByTestId('invite-scroll');
    expect(scroller.className).toContain('min-h-0');
    expect(scroller.className.split(' ')).not.toContain('flex-col');
    fireEvent.click(within(screen.getByTestId('invite-box')).getByRole('button', { name: 'Close' }));
    expect(document.body.style.overflow).toBe('');
  });

  // ── Round one of the review ──

  it("with people ticked, the Invite above the list gives way to the bar: nothing may go to the Filter's whole group from there", async () => {
    draw();
    await screen.findByText('Ben Carter');
    expect(screen.getByTestId('invite-button')).toBeTruthy();
    fireEvent.click(tickOf('Ben Carter'));
    expect(screen.queryByTestId('invite-button')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /Invite to app/ })).toHaveLength(2); // the bar, computer and phone
    for (const b of screen.getAllByRole('button', { name: /Invite to app/ })) expect(b.getAttribute('data-testid')).toBe('bar-invite');
    fireEvent.click(bar().getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('invite-button')).toBeTruthy();
  });

  it('a Select all that moved clears the old numbers, so Send waits for the new count', async () => {
    draw();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every member on this page' }));
    orgService.selectAllMembers.mockResolvedValue({ data: { selection: { count: 312, digest: DIGEST } } });
    fireEvent.click(within(screen.getByTestId('select-line')).getByRole('button', { name: 'Select all 312 members' }));
    await waitFor(() => expect(bar().getByTestId('sel-count').textContent).toBe('312 selected'));
    orgService.getSelectedInvitePreview.mockResolvedValueOnce(preview(300));
    let answer;
    orgService.getSelectedInvitePreview.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    fireEvent.click(bar().getByTestId('bar-invite'));
    const box = within(await screen.findByTestId('invite-box'));
    await box.findByRole('button', { name: 'Send 300 invitations' });
    orgService.pressInvite.mockRejectedValue({
      response: { status: 409, data: { error: 'selection_changed', message: 'The members you selected have changed, so nothing was done. Check who is selected now and try again.', count: 314, digest: 'b'.repeat(64) } },
    });
    fireEvent.click(box.getByRole('checkbox', { name: /I have permission to email them/ }));
    fireEvent.click(box.getByRole('button', { name: 'Send 300 invitations' }));
    // The old count is gone at once: no Send button to press with it.
    await waitFor(() => expect(box.queryByRole('button', { name: /^Send \d/ })).toBeNull());
    expect(bar().getByTestId('sel-count').textContent).toBe('314 selected');
    answer(preview(302));
    expect(await box.findByRole('button', { name: 'Send 302 invitations' })).toBeTruthy();
    expect(orgService.getSelectedInvitePreview).toHaveBeenLastCalledWith(GYM, { kind: 'all', filter: {}, count: 314, digest: 'b'.repeat(64) });
    expect(orgService.pressInvite).toHaveBeenCalledTimes(1);
  });

});
