// Bringing a member list in (ROADMAP 5a). The server decides everything; these prove
// the screen shows its numbers and sends back exactly what staff answered.
//
// THE WORST THING THIS SCREEN COULD DO: let staff confirm the wrong file and take real
// people off the gym's list without ever seeing whose names. So the first test: the
// names coming off can be opened before Confirm, and Confirm stays off until the typed
// number matches.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListPreviewSchema, memberListRowsPageSchema, memberListConfirmedSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: { uploadMemberList: vi.fn(), getMemberListRows: vi.fn(), confirmMemberList: vi.fn() },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListUpload = (await import('./MemberListUpload')).default;

const GYM = '11111111-1111-1111-1111-111111111111';
const UPLOAD = '22222222-2222-2222-2222-222222222222';
const WORDS = { people: 'members', person: 'member' };

const counts = (over = {}) => ({
  dataRows: 3, kept: 3, noContact: 0, duplicates: 0, withEmail: 3, withPhone: 0, withMemberNumber: 0,
  withStatus: 3, withMembershipType: 0, withJoinedOn: 0, withEndsOn: 0, withPaymentStatus: 0, withDateOfBirth: 0, ...over,
});

const baseMapping = {
  sheet: null, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1], phone: [], memberNumber: null,
  status: 2, membershipType: null, joinedOn: 3, endsOn: null, paymentStatus: null, dateOfBirth: null, dontKeep: [], dateOrder: [],
};

/** A preview shaped by the real contract: a fixture the schema refuses fails here. */
function preview(over = {}) {
  return memberListPreviewSchema.parse({
    uploadId: UPLOAD,
    mode: 'whole_list',
    expiresAt: '2026-09-24T12:00:00.000Z',
    sameAsLastUpload: false,
    kind: 'csv',
    facts: {},
    sheet: { index: 0, name: null },
    headerRow: 0,
    columns: [
      { index: 0, header: 'Name', samples: ['Ada Lovelace'], guess: 'fullName', confidence: 'header', headerSays: 'fullName', neverKept: null },
      { index: 1, header: 'Email', samples: ['ada@members.example'], guess: 'email', confidence: 'header', headerSays: 'email', neverKept: null },
      { index: 2, header: 'Status', samples: ['Active'], guess: 'status', confidence: 'header', headerSays: 'status', neverKept: null },
      { index: 3, header: 'Joined', samples: ['03/04/2026'], guess: 'joinedOn', confidence: 'header', headerSays: 'joinedOn', neverKept: null },
      { index: 4, header: 'Card', samples: [], guess: null, confidence: null, headerSays: null, neverKept: 'payment_card' },
    ],
    mapping: baseMapping,
    needsMapping: false,
    file: counts(),
    list: { new: 3, changed: 0, unchanged: 0, gone: 0, alreadyInApp: 0, canBeInvited: 3, noEmail: 0, returning: 0 },
    statuses: [{ label: 'Active', count: 3, new: 3, changed: 0, unchanged: 0, gone: 0 }],
    members: { leaving: 0, listedNow: 0 },
    skipped: [],
    warnings: [],
    seat: { cap: 200, liveMembers: 0, listSize: 0 },
    guard: { entriesGoing: 0, listSize: 0, membersLeaving: 0, membersListedNow: 0, needsTick: false, mostOfListWouldGo: false },
    ...over,
  });
}
const withDates = () =>
  preview({
    dateColumns: [{ column: 3, field: 'joinedOn', order: 'dayFirst', from: 'country', example: { raw: '03/04/2026', read: '2026-04-03' }, notRead: 0 }],
  });

const confirmedAnswer = (over = {}) =>
  memberListConfirmedSchema.parse({
    uploadId: UPLOAD, alreadyConfirmed: false, version: 1, confirmedAt: '2026-09-24T11:00:00.000Z',
    applied: { new: 3, changed: 0, unchanged: 0, gone: 0, alreadyInApp: 0, canBeInvited: 3, noEmail: 0, returning: 0 },
    statuses: [], members: { leaving: 0, listedNow: 0 }, ...over,
  });

const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

async function openWith(p) {
  orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: p } });
  render(<MemberListUpload gymId={GYM} gymName="Iron House" words={WORDS} readOnly={false} onApplied={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/paste them here/), { target: { value: 'Name\tEmail\nAda\tada@members.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Read the pasted rows' }));
  await screen.findByTestId('member-list-preview');
}

const confirmButton = () => screen.getByRole('button', { name: 'Confirm' });
const tickPermission = () => fireEvent.click(screen.getByLabelText(/allowed to keep these people's details/));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('the worst thing: a wrong file cannot take people off unseen', () => {
  it('shows the names coming off, and Confirm waits for the typed number', async () => {
    const guard = { entriesGoing: 120, listSize: 150, membersLeaving: 4, membersListedNow: 10, needsTick: true, mostOfListWouldGo: true };
    await openWith(
      preview({
        list: { new: 0, changed: 0, unchanged: 30, gone: 120, alreadyInApp: 0, canBeInvited: 0, noEmail: 0, returning: 0 },
        members: { leaving: 4, listedNow: 10 },
        guard,
      }),
    );
    orgService.getMemberListRows.mockResolvedValueOnce({
      data: {
        page: memberListRowsPageSchema.parse({
          group: 'gone', total: 120, cursor: 100,
          people: [{ row: null, fullName: 'Grace Hopper', email: 'grace@members.example', phone: null, memberNumber: null, status: 'Active', wasStatus: null, inApp: true }],
        }),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /120 no longer on your list/ }));
    const names = await screen.findByTestId('names-gone');
    expect(within(names).getByText('Grace Hopper')).toBeTruthy();
    expect(within(names).getByText('In the app')).toBeTruthy();
    expect(orgService.getMemberListRows).toHaveBeenCalledWith(GYM, UPLOAD, 'gone', 0);

    tickPermission();
    expect(confirmButton().disabled).toBe(true);
    const box = screen.getByLabelText('Type the number to go ahead');
    fireEvent.change(box, { target: { value: '12' } });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(box, { target: { value: '120' } });
    expect(confirmButton().disabled).toBe(false);

    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(confirmButton());
    await screen.findByTestId('member-list-done');
    expect(orgService.confirmMemberList).toHaveBeenCalledWith(GYM, UPLOAD, {
      permissionConfirmed: true,
      acknowledgeLargeChange: true,
      acknowledgeHandEdits: false,
    });
  });

  it('offers "Add these people instead" when most of the list would go, and reads the same rows that way', async () => {
    const guard = { entriesGoing: 120, listSize: 150, membersLeaving: 0, membersListedNow: 0, needsTick: true, mostOfListWouldGo: true };
    await openWith(preview({ list: { new: 0, changed: 0, unchanged: 30, gone: 120, alreadyInApp: 0, canBeInvited: 0, noEmail: 0, returning: 0 }, guard }));
    const sent = orgService.uploadMemberList.mock.calls[0][1].contentBase64;
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview({ mode: 'add' }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add these people instead' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1]).toMatchObject({ contentBase64: sent, mode: 'add' });
    expect(await screen.findByText(/as people to add/)).toBeTruthy();
  });

  it('a 409 large_change with new numbers asks for the new number, not the old one', async () => {
    await openWith(preview());
    tickPermission();
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, {
        error: 'large_change',
        message: 'This would change more of your list than we apply without asking. Check the numbers below, then confirm again to go ahead.',
        guard: { entriesGoing: 40, listSize: 50, membersLeaving: 0, membersListedNow: 0, needsTick: true, mostOfListWouldGo: false },
      }),
    );
    fireEvent.click(confirmButton());
    expect(await screen.findByText(/change more of your list than we apply without asking/)).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type the number to go ahead'), { target: { value: '40' } });
    expect(confirmButton().disabled).toBe(false);
  });
});

describe('the permission tick', () => {
  it("names the gym, and Confirm waits for it", async () => {
    await openWith(preview());
    expect(screen.getByText("I confirm Iron House is allowed to keep these people's details in AI Home Gym.")).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    tickPermission();
    expect(confirmButton().disabled).toBe(false);
  });
});

describe('reading a file or pasted rows', () => {
  it('sends pasted rows as UTF-8 with its byte-order mark, as the chosen mode', async () => {
    await openWith(preview());
    const body = orgService.uploadMemberList.mock.calls[0][1];
    expect(body.mode).toBe('whole_list');
    expect(body.mapping).toBeUndefined();
    const bytes = Uint8Array.from(atob(body.contentBase64), (c) => c.charCodeAt(0));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('Name\tEmail\nAda\tada@members.example');
  });

  it("prints the server's refusal as sent", async () => {
    orgService.uploadMemberList.mockRejectedValueOnce(refusal(422, { error: 'old_excel', message: 'This is an old Excel file (.xls). Save it as .xlsx or CSV and upload that.' }));
    render(<MemberListUpload gymId={GYM} gymName="Iron House" words={WORDS} readOnly={false} />);
    fireEvent.change(screen.getByLabelText(/paste them here/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read the pasted rows' }));
    expect(await screen.findByText('This is an old Excel file (.xls). Save it as .xlsx or CSV and upload that.')).toBeTruthy();
  });

  it('reads a chosen file', async () => {
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    render(<MemberListUpload gymId={GYM} gymName="Iron House" words={WORDS} readOnly={false} />);
    fireEvent.click(screen.getByLabelText(/Add these people/));
    const file = new File(['Name,Email\nAda,ada@members.example'], 'members.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('member-file'), { target: { files: [file] } });
    await screen.findByTestId('member-list-preview');
    const body = orgService.uploadMemberList.mock.calls[0][1];
    expect(body.mode).toBe('add');
    expect(atob(body.contentBase64)).toBe('Name,Email\nAda,ada@members.example');
    expect(screen.getByText(/from members.csv/)).toBeTruthy();
  });
});

describe('the columns', () => {
  it('names a column that is never kept, with no way to switch it on', async () => {
    await openWith(preview());
    const card = within(screen.getByTestId('column-4'));
    expect(card.getByText('Not kept: this looks like payment card numbers. We never store card details.')).toBeTruthy();
    expect(card.queryByRole('combobox')).toBeNull();
  });

  it("a changed column is sent back as staff's mapping, and Confirm waits until it is read again", async () => {
    await openWith(preview());
    fireEvent.click(screen.getByRole('button', { name: /Check the columns/ }));
    fireEvent.change(screen.getByLabelText('What Status holds'), { target: { value: 'membershipType' } });
    tickPermission();
    expect(confirmButton().disabled).toBe(true);
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    fireEvent.click(screen.getByRole('button', { name: 'Read again with these columns' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].mapping).toMatchObject({ status: null, membershipType: 2 });
  });

  it('flips a date column and reads it again', async () => {
    await openWith(withDates());
    expect(screen.getByText('Join date: we read 03/04/2026 as 3 April 2026.')).toBeTruthy();
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    fireEvent.click(screen.getByRole('button', { name: /Read it the other way/ }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].mapping.dateOrder).toEqual([{ column: 3, order: 'monthFirst' }]);
  });
});

describe('Confirm and its refusals', () => {
  it('shows the result line and says nobody was emailed', async () => {
    await openWith(preview());
    tickPermission();
    orgService.confirmMemberList.mockResolvedValueOnce({
      data: {
        confirmed: confirmedAnswer({
          applied: { new: 12, changed: 2, unchanged: 5, gone: 3, alreadyInApp: 0, canBeInvited: 12, noEmail: 0, returning: 0 },
        }),
      },
    });
    fireEvent.click(confirmButton());
    const done = await screen.findByTestId('member-list-done');
    expect(within(done).getByText('12 new · 2 changed · 3 no longer on your list')).toBeTruthy();
    expect(within(done).getByText(/Nobody has been emailed/)).toBeTruthy();
  });

  it('a 409 hand_edits names the fields and sends the second tick', async () => {
    await openWith(preview());
    tickPermission();
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, { error: 'hand_edits', message: 'This file would replace details your staff typed in here.', handEdits: { entries: 3, fields: ['phone number', 'membership type'] } }),
    );
    fireEvent.click(confirmButton());
    const tick = await screen.findByLabelText(/for 3 people: phone number, membership type/);
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(tick);
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(confirmButton());
    await screen.findByTestId('member-list-done');
    expect(orgService.confirmMemberList.mock.calls[1][2]).toEqual({ permissionConfirmed: true, acknowledgeLargeChange: false, acknowledgeHandEdits: true });
  });

  it('a list changed meanwhile offers to read the same file again', async () => {
    await openWith(preview());
    const sent = orgService.uploadMemberList.mock.calls[0][1].contentBase64;
    tickPermission();
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, { error: 'list_changed', message: 'Your list changed while you were looking at this preview, so nothing was applied.', baseVersion: 1, version: 2 }),
    );
    fireEvent.click(confirmButton());
    expect(await screen.findByText(/Your list changed while you were looking/)).toBeTruthy();
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    fireEvent.click(screen.getByRole('button', { name: 'Read the file again' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].contentBase64).toBe(sent);
  });

  it('a file with no email or phone column cannot be confirmed', async () => {
    await openWith(preview({ needsMapping: true }));
    expect(screen.getByText(/couldn.t find an email or phone column/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.getByLabelText('What Name holds')).toBeTruthy();
  });
});
