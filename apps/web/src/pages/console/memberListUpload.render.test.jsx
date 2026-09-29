// Importing a member list (ROADMAP 5a). The server decides everything; these prove the
// box shows what matters and sends back exactly what staff answered.
//
// THE WORST THING THIS SCREEN COULD DO: let staff import the wrong file and take real
// people off the gym's list without ever seeing whose names. So the first test: the
// people missing from the file are named before anything can be imported, nothing is
// picked for staff, and a large change waits for the typed number.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListConfirmedSchema, memberListLeaversSchema, memberListMissingSchema, memberListPreviewSchema, memberListRowsPageSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      uploadMemberList: vi.fn(),
      getMemberListRows: vi.fn(),
      confirmMemberList: vi.fn(),
      getMemberListMissing: vi.fn(),
      getMemberListLeavers: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListUpload = (await import('./MemberListUpload')).default;

const GYM = '11111111-1111-1111-1111-111111111111';
const UPLOAD = '22222222-2222-2222-2222-222222222222';
const UPLOAD_ADD = '33333333-3333-3333-3333-333333333333';
const WORDS = { people: 'members', person: 'member' };

const counts = (over = {}) => ({
  dataRows: 30, kept: 30, noContact: 0, duplicates: 0, withEmail: 30, withPhone: 0, withMemberNumber: 0,
  withStatus: 30, withMembershipType: 0, withJoinedOn: 0, withEndsOn: 0, withPaymentStatus: 0, withDateOfBirth: 0, ...over,
});
const list = (over = {}) => ({ new: 0, changed: 0, unchanged: 0, gone: 0, alreadyInApp: 0, canBeInvited: 0, noEmail: 0, returning: 0, ...over });
const calm = { entriesGoing: 0, listSize: 0, membersLeaving: 0, membersListedNow: 0, needsTick: false, mostOfListWouldGo: false };

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
    list: list({ new: 30, canBeInvited: 30 }),
    statuses: [],
    members: { leaving: 0, listedNow: 0 },
    skipped: [],
    warnings: [],
    seat: { cap: 200, liveMembers: 0, listSize: 0 },
    guard: calm,
    ...over,
  });
}

const person = (fullName, over = {}) => ({
  row: null, fullName, email: `${fullName.split(' ')[0].toLowerCase()}@members.example`, phone: null, memberNumber: null,
  status: 'Active', wasStatus: null, inApp: false, onList: null, ...over,
});
const namesRows = (root) => root.getAllByTestId('names-row');

const DIGEST = 'a'.repeat(64);
const DIGEST_BOX = 'c'.repeat(64);
const USER = '44444444-4444-4444-4444-444444444444';
const entryId = (n) => `55555555-5555-5555-5555-${String(n).padStart(12, '0')}`;
/** Somebody the file leaves out, as the missing-people read gives them (§18.8). */
const missingOne = (n, fullName, over = {}, onList = {}) => ({
  entryId: entryId(n),
  fullName,
  email: `${fullName.split(' ')[0].toLowerCase()}@members.example`,
  phone: null,
  memberNumber: null,
  wasStatus: 'Active',
  inApp: false,
  onList: { membershipType: 'Gold', endsOn: null, endsOnKind: null, paymentStatus: 'Paid', source: 'upload', addedAt: '2026-01-05T10:00:00.000Z', ...onList },
  ...over,
});
const missingRead = (people) => ({ data: { missing: memberListMissingSchema.parse({ total: people.length, digest: DIGEST, people }) } });
const who = (name, n) => ({ name, entryId: entryId(n), userId: null });
const leaversRead = ({ move = [], endApp = [], kept = [], stay = 0, movingNotInApp = 0, guard = calm, digest = DIGEST_BOX } = {}) => ({
  data: {
    leavers: memberListLeaversSchema.parse({
      preview: { selected: move.length, move, endApp, kept, movingNotInApp, large: null, digest },
      stay,
      guard,
    }),
  },
});
const page = (group, people, total, cursor = null) => ({ data: { page: memberListRowsPageSchema.parse({ group, total, people, cursor }) } });

const confirmedAnswer = (over = {}) =>
  memberListConfirmedSchema.parse({
    uploadId: UPLOAD, alreadyConfirmed: false, version: 1, confirmedAt: '2026-09-24T11:00:00.000Z',
    applied: list({ new: 30, canBeInvited: 30 }),
    statuses: [], members: { leaving: 0, listedNow: 0 }, ...over,
  });

const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

let onClose;
let onImported;

function renderBox() {
  onClose = vi.fn();
  onImported = vi.fn();
  render(<MemberListUpload gymId={GYM} gym={{ name: 'Iron House Gym' }} words={WORDS} readOnly={false} onClose={onClose} onImported={onImported} />);
}

/** Opens the box, pastes two rows, and waits for Review with `p`. */
async function reviewWith(p) {
  orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: p } });
  renderBox();
  fireEvent.click(screen.getByRole('tab', { name: 'Paste rows' }));
  fireEvent.change(screen.getByLabelText('Paste your rows'), { target: { value: 'Name\tEmail\nAda\tada@members.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Review' });
}

const importButton = () => screen.getByRole('button', { name: /^Import/ });
const tickPermission = () => fireEvent.click(screen.getByLabelText("These are Iron House Gym's members, and I have permission to store their details."));

// Reset, not only clear: an answer a failed test queued must not reach the next one.
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('the worst thing: nobody leaves who was not answered for', () => {
  const wrongFile = () =>
    preview({
      list: list({ unchanged: 5, gone: 25 }),
      statuses: [
        { label: 'Active', count: 5, new: 0, changed: 0, unchanged: 5, gone: 20 },
        { label: 'Frozen', count: 0, new: 0, changed: 0, unchanged: 0, gone: 5 },
      ],
      members: { leaving: 2, listedNow: 4 },
      guard: { entriesGoing: 25, listSize: 30, membersLeaving: 2, membersListedNow: 4, needsTick: true, mostOfListWouldGo: true },
    });
  const olivia = missingOne(1, 'Olivia Walker', { inApp: true });
  const liam = missingOne(2, 'Liam Hughes', { wasStatus: 'Cancelled' }, { endsOn: '2026-08-31', endsOnKind: 'ends', paymentStatus: 'Unpaid' });
  const emma = missingOne(3, 'Emma Price', { wasStatus: 'Frozen' }, { membershipType: null, paymentStatus: null, source: 'typed', addedAt: '2026-09-20T09:30:00.000Z' });
  const oneMissing = () => preview({ list: list({ unchanged: 4, gone: 1 }), guard: { ...calm, entriesGoing: 1, listSize: 5 } });
  const choice = (name) => screen.getByRole('radio', { name });

  it('the card as it was: names with details, nothing chosen, and They\'ve left moves only the people ticked', async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia, liam, emma]));
    await reviewWith(wrongFile());
    const card = within(await screen.findByTestId('missing'));
    expect(card.getByText("25 of your 30 members aren't in this file")).toBeTruthy();
    expect(card.getByTestId('missing-help').textContent).toContain('members missing from it have usually left');
    expect(card.getByTestId('missing-statuses').textContent).toBe('Status: Active 20 · Frozen 5');
    expect(screen.queryByText('No changes')).toBeNull();
    expect(orgService.getMemberListMissing).toHaveBeenCalledWith(GYM, UPLOAD);
    expect(orgService.getMemberListRows).not.toHaveBeenCalled();

    const rows = await card.findAllByTestId('missing-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Olivia Walker'),
      expect.stringContaining('Liam Hughes'),
      expect.stringContaining('Emma Price'),
    ]);
    expect(within(rows[0]).getByTestId('gone-facts').textContent).toBe('Status: Active · Membership: Gold · Payment: Paid');
    // The end date beside the status: a Cancelled reads with when (Kd, 2026-09-29).
    expect(within(rows[1]).getByTestId('gone-facts').textContent).toMatch(/^Status: Cancelled · Ended 31 Aug( 2026)? · Membership: Gold · Payment: Unpaid$/);
    expect(within(rows[2]).getByTestId('gone-added').textContent).toMatch(/^Added manually · 20 Sep( 2026)?$/);
    expect(within(rows[0]).getByText('In the app')).toBeTruthy();
    expect(within(rows[1]).queryByText('In the app')).toBeNull();

    // Nothing is chosen or ticked for staff, and Import waits for an answer.
    expect([choice(/They've left/), choice(/They're still members/)].map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(card.getAllByRole('checkbox').map((b) => b.checked)).toEqual([false, false, false]);
    tickPermission();
    expect(importButton().disabled).toBe(true);

    fireEvent.click(card.getByLabelText('Liam Hughes has left'));
    fireEvent.click(card.getByLabelText('Emma Price has left'));
    expect(choice(/They've left/).textContent).toContain('Move the 2 ticked to past members');
    fireEvent.click(choice(/They've left/));
    // The big-change number is typed in the box, not on the card.
    expect(screen.queryByLabelText('Type the number to confirm')).toBeNull();
    expect(importButton().disabled).toBe(false);

    orgService.getMemberListLeavers.mockResolvedValueOnce(
      leaversRead({ move: [who('Emma Price', 3), who('Liam Hughes', 2)], stay: 1, guard: { ...wrongFile().guard, entriesGoing: 2 } }),
    );
    fireEvent.click(importButton());
    const box = within(await screen.findByTestId('leavers-box'));
    const sentMarks = { missingDigest: DIGEST, left: [liam.entryId, emma.entryId], stay: [olivia.entryId] };
    expect(orgService.getMemberListLeavers).toHaveBeenCalledWith(GYM, UPLOAD, sentMarks);
    expect(box.getByText('2 will move to past members')).toBeTruthy();
    expect(box.getByTestId('leavers-stay').textContent).toBe('1 not ticked stays on your list.');
    const go = box.getByRole('button', { name: 'Import and move 2 to past members' });
    expect(go.disabled).toBe(true);
    fireEvent.change(box.getByLabelText('Type the number to confirm'), { target: { value: '25' } });
    expect(go.disabled).toBe(true);
    fireEvent.change(box.getByLabelText('Type the number to confirm'), { target: { value: '2' } });
    expect(go.disabled).toBe(false);

    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(go);
    await screen.findByTestId('member-import-done');
    expect(orgService.confirmMemberList).toHaveBeenCalledWith(GYM, UPLOAD, {
      permissionConfirmed: true,
      acknowledgeLargeChange: true,
      acknowledgeHandEdits: false,
      marks: sentMarks,
      leaversDigest: DIGEST_BOX,
    });
  });

  it("They've left with nobody ticked moves everyone, as before", async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia, liam]));
    await reviewWith(preview({ list: list({ unchanged: 4, gone: 2 }), guard: { ...calm, entriesGoing: 2, listSize: 6 } }));
    await screen.findAllByTestId('missing-row');
    expect(choice(/They've left/).textContent).toContain('Move to past members');
    fireEvent.click(choice(/They've left/));
    tickPermission();
    orgService.getMemberListLeavers.mockResolvedValueOnce(leaversRead({ move: [who('Liam Hughes', 2), who('Olivia Walker', 1)] }));
    fireEvent.click(importButton());
    await screen.findByTestId('leavers-box');
    expect(orgService.getMemberListLeavers).toHaveBeenCalledWith(GYM, UPLOAD, { missingDigest: DIGEST, left: [olivia.entryId, liam.entryId], stay: [] });
  });

  it("They're still members keeps everyone, whoever is ticked, and imports with no box", async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia, liam]));
    await reviewWith(preview({ list: list({ new: 3, unchanged: 5, gone: 2 }), guard: { ...calm, entriesGoing: 2, listSize: 40 } }));
    const card = within(await screen.findByTestId('missing'));
    fireEvent.click(await card.findByLabelText('Liam Hughes has left'));
    fireEvent.click(choice(/They've left/));
    expect(importButton().textContent).toBe('Import');
    fireEvent.click(choice(/They're still members/));
    expect(importButton().textContent).toBe('Import 3 members');
    // No second read of the file: the answer goes with the press.
    expect(orgService.uploadMemberList).toHaveBeenCalledTimes(1);
    tickPermission();
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(importButton());
    await screen.findByTestId('member-import-done');
    expect(orgService.getMemberListLeavers).not.toHaveBeenCalled();
    expect(orgService.confirmMemberList).toHaveBeenCalledWith(GYM, UPLOAD, {
      permissionConfirmed: true,
      acknowledgeLargeChange: false,
      acknowledgeHandEdits: false,
      marks: { missingDigest: DIGEST, left: [], stay: [olivia.entryId, liam.entryId] },
    });
  });

  it("They're still members while the wrong-file check asks: the number to type is on the card, and the press sends it (round one, High-1)", async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia]));
    await reviewWith(oneMissing());
    await screen.findAllByTestId('missing-row');
    fireEvent.click(choice(/They're still members/));
    tickPermission();
    const keepGuard = { entriesGoing: 0, listSize: 12, membersLeaving: 11, membersListedNow: 11, needsTick: true, mostOfListWouldGo: false };
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, {
        error: 'large_change',
        message: 'This would change more of your list than we apply without asking. Check the numbers below, then confirm again to go ahead.',
        guard: keepGuard,
      }),
    );
    fireEvent.click(importButton());
    expect(await screen.findByText('11 people who use the app would no longer be on your list.')).toBeTruthy();
    const box = screen.getByLabelText('Type the number to confirm');
    expect(importButton().disabled).toBe(true);
    fireEvent.change(box, { target: { value: '10' } });
    expect(importButton().disabled).toBe(true);
    fireEvent.change(box, { target: { value: '11' } });
    expect(importButton().disabled).toBe(false);
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(importButton());
    await screen.findByTestId('member-import-done');
    expect(orgService.confirmMemberList.mock.calls[1][2]).toEqual({
      permissionConfirmed: true,
      acknowledgeLargeChange: true,
      acknowledgeHandEdits: false,
      marks: { missingDigest: DIGEST, left: [], stay: [olivia.entryId] },
    });
  });

  it("choosing They've left after a refused keep press forgets that number, so a later keep never shows They've left's (re-check Low)", async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia]));
    await reviewWith(oneMissing());
    await screen.findAllByTestId('missing-row');
    fireEvent.click(choice(/They're still members/));
    tickPermission();
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, {
        error: 'large_change',
        message: 'This would change more of your list than we apply without asking.',
        guard: { entriesGoing: 0, listSize: 12, membersLeaving: 11, membersListedNow: 11, needsTick: true, mostOfListWouldGo: false },
      }),
    );
    fireEvent.click(importButton());
    expect(await screen.findByTestId('keep-typing')).toBeTruthy();

    // They've left instead; its box's press is refused with the leavers' own numbers.
    fireEvent.click(choice(/They've left/));
    orgService.getMemberListLeavers.mockResolvedValueOnce(leaversRead({ move: [who('Olivia Walker', 1)] }));
    fireEvent.click(importButton());
    const box = within(await screen.findByTestId('leavers-box'));
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, {
        error: 'large_change',
        message: 'This would change more of your list than we apply without asking.',
        guard: { entriesGoing: 25, listSize: 30, membersLeaving: 0, membersListedNow: 4, needsTick: true, mostOfListWouldGo: true },
      }),
    );
    fireEvent.click(box.getByRole('button', { name: 'Import and move 1 to past members' }));
    await waitFor(() => expect(screen.queryByTestId('leavers-box')).toBeNull());

    // Back to keep: no number from They've left is asked for.
    fireEvent.click(choice(/They're still members/));
    expect(screen.queryByTestId('keep-typing')).toBeNull();
    expect(screen.queryByText(/would come off your list/)).toBeNull();
  });

  it('the card says what a tick does, and with people ticked They\'re still members says it keeps them too (round one, Low-2)', async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia, liam]));
    await reviewWith(preview({ list: list({ unchanged: 4, gone: 2 }), guard: { ...calm, entriesGoing: 2, listSize: 6 } }));
    const card = within(await screen.findByTestId('missing'));
    expect(card.getByTestId('missing-tick-help').textContent).toBe("Tick the people who have left. If you tick nobody, They've left moves everyone.");
    expect(choice(/They're still members/).textContent).toContain('Leave them on the list');
    fireEvent.click(await card.findByLabelText('Liam Hughes has left'));
    expect(choice(/They're still members/).textContent).toContain('Keep all 2 on the list, ticked or not');
  });

  it('who loses the app is named in the box, and a box that moved is shown again before anything is imported', async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia]));
    await reviewWith(oneMissing());
    await screen.findAllByTestId('missing-row');
    fireEvent.click(choice(/They've left/));
    tickPermission();
    orgService.getMemberListLeavers.mockResolvedValueOnce(leaversRead({ move: [who('Olivia Walker', 1)], movingNotInApp: 1 }));
    fireEvent.click(importButton());
    const box = within(await screen.findByTestId('leavers-box'));
    expect(box.queryByTestId('leavers-endApp')).toBeNull();
    // No typed number for one person.
    expect(box.queryByLabelText('Type the number to confirm')).toBeNull();

    // Olivia joined the app meanwhile: nothing is imported, and the new box names her.
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, {
        error: 'leavers_changed',
        message: 'Who would lose the app changed while you were looking, so nothing was imported. Look at the names again.',
        leavers: leaversRead({ move: [who('Olivia Walker', 1)], endApp: [{ name: 'Olivia Walker', entryId: null, userId: USER }], digest: 'b'.repeat(64) }).data.leavers,
      }),
    );
    fireEvent.click(box.getByRole('button', { name: 'Import and move 1 to past members' }));
    expect(await box.findByTestId('leavers-note')).toBeTruthy();
    expect(within(box.getByTestId('leavers-endApp')).getByText('1 will lose access to the app')).toBeTruthy();
    expect(screen.queryByTestId('member-import-done')).toBeNull();
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(box.getByRole('button', { name: 'Import and move 1 to past members' }));
    await screen.findByTestId('member-import-done');
    expect(orgService.confirmMemberList.mock.calls[1][2].leaversDigest).toBe('b'.repeat(64));
  });

  it('a refusal in the box closes it and offers to read the file again, which asks afresh', async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia]));
    await reviewWith(oneMissing());
    const card = within(await screen.findByTestId('missing'));
    fireEvent.click(await card.findByLabelText('Olivia Walker has left'));
    fireEvent.click(choice(/They've left/));
    tickPermission();
    orgService.getMemberListLeavers.mockResolvedValueOnce(leaversRead({ move: [who('Olivia Walker', 1)] }));
    fireEvent.click(importButton());
    const box = within(await screen.findByTestId('leavers-box'));
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, { error: 'list_changed', message: 'Your list changed while you were looking at this preview, so nothing was applied.', baseVersion: 1, version: 1 }),
    );
    fireEvent.click(box.getByRole('button', { name: 'Import and move 1 to past members' }));
    expect(await screen.findByText(/Your list changed while you were looking/)).toBeTruthy();
    expect(screen.queryByTestId('leavers-box')).toBeNull();

    orgService.uploadMemberList.mockResolvedValueOnce({
      data: { preview: preview({ uploadId: UPLOAD_ADD, list: list({ unchanged: 4, gone: 2 }), guard: { ...calm, entriesGoing: 2, listSize: 6 } }) },
    });
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia, liam]));
    fireEvent.click(screen.getByRole('button', { name: 'Read the file again' }));
    await waitFor(() => expect(screen.getAllByTestId('missing-row')).toHaveLength(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].mode).toBe('whole_list');
    expect(within(screen.getByTestId('missing')).getAllByRole('checkbox').map((b) => b.checked)).toEqual([false, false]);
    expect(choice(/They've left/).getAttribute('aria-checked')).toBe('false');
    expect(importButton().disabled).toBe(true);
  });

  it('other columns read the file again and ask afresh', async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia]));
    await reviewWith(oneMissing());
    const card = within(await screen.findByTestId('missing'));
    fireEvent.click(await card.findByLabelText('Olivia Walker has left'));
    fireEvent.click(choice(/They've left/));
    fireEvent.click(screen.getByRole('button', { name: 'See columns' }));
    fireEvent.change(screen.getByLabelText('Status imports as'), { target: { value: 'membershipType' } });
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: oneMissing() } });
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia]));
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(orgService.getMemberListMissing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('Olivia Walker has left').checked).toBe(false));
    expect(choice(/They've left/).getAttribute('aria-checked')).toBe('false');
  });

  it('when the names cannot be read, Import waits and Try again reads them', async () => {
    orgService.getMemberListMissing.mockRejectedValueOnce(new Error('offline'));
    await reviewWith(oneMissing());
    expect(await screen.findByText("We couldn't load the names.")).toBeTruthy();
    fireEvent.click(choice(/They've left/));
    tickPermission();
    expect(importButton().disabled).toBe(true);
    orgService.getMemberListMissing.mockResolvedValueOnce(missingRead([olivia]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('missing-row')).toBeTruthy();
    expect(importButton().disabled).toBe(false);
  });
});

// THE NEW LOOK (5b-v-d-ii) CHANGES HOW THE BOX LOOKS, NEVER WHAT IT SHOWS: every step,
// line and tick below was on the screen before the restyle, in this order.
describe('every part of the box, in its order', () => {
  /** True when every text is on the page once or more, each after the one before it. */
  const inOrder = (nodes) => {
    for (let i = 1; i < nodes.length; i += 1) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  };

  it('Upload: both ways in, the drop box and its words, and pasted rows with Continue', async () => {
    renderBox();
    expect(screen.getByRole('heading', { name: 'Import members' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Upload a file' }).getAttribute('aria-selected')).toBe('true');
    const drop = within(screen.getByTestId('drop-zone'));
    expect(drop.getByText('Drop your file here')).toBeTruthy();
    expect(screen.getByTestId('drop-zone').textContent).toContain('or choose a file · CSV or Excel');
    fireEvent.click(screen.getByRole('tab', { name: 'Paste rows' }));
    expect(screen.getByLabelText('Paste your rows').getAttribute('placeholder')).toBe(
      'Copy the rows in your spreadsheet, with the headings, and paste them here.',
    );
    expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('Review with everything at once: the file, the numbers, who is missing and the two answers, every check line, both ticks, Import', async () => {
    orgService.getMemberListMissing.mockResolvedValueOnce(
      missingRead([missingOne(1, 'Olivia Walker', { inApp: true }), missingOne(2, 'Liam Hughes', { wasStatus: 'Cancelled' })]),
    );
    await reviewWith(
      preview({
        file: counts({ dataRows: 40, noContact: 1, duplicates: 1 }),
        list: list({ new: 3, changed: 2, unchanged: 33, gone: 2, canBeInvited: 3 }),
        statuses: [{ label: 'Active', count: 36, new: 3, changed: 2, unchanged: 31, gone: 1 }, { label: 'Cancelled', count: 2, new: 0, changed: 0, unchanged: 2, gone: 1 }],
        guard: { ...calm, entriesGoing: 2, listSize: 37 },
        dateColumns: [{ column: 3, field: 'joinedOn', order: 'dayFirst', from: 'country', example: { raw: '03/04/2026', read: '2026-04-03' }, notRead: 0 }],
        warnings: [{ code: 'phones_unusual', rows: 4 }],
        skipped: [{ row: 7, reason: 'no_contact', name: 'Walk-in Guest' }, { row: 9, reason: 'duplicate', name: 'Ada Lovelace', sameAsRow: 2 }],
        handEdits: { entries: 2, fields: ['phone number'], names: ['Ada Lovelace', 'Bo Chen'] },
      }),
    );
    await screen.findAllByTestId('missing-row');
    const box = screen.getByTestId('member-import');
    const at = (text) => within(box).getByText(text);
    inOrder([
      screen.getByRole('button', { name: 'Back' }),
      screen.getByRole('heading', { name: 'Review' }),
      screen.getByRole('button', { name: 'Close' }),
      at('Pasted rows'),
      at('40 rows'),
      screen.getByRole('button', { name: 'Change' }),
      screen.getByRole('button', { name: /3\s*New/ }),
      screen.getByRole('button', { name: /2\s*Updated/ }),
      screen.getByRole('button', { name: /33\s*Already on your list/ }),
      at('2 members aren\'t in this file'),
      screen.getByTestId('missing-help'),
      at('Status: Active 1 · Cancelled 1'),
      at("Tick the people who have left. If you tick nobody, They've left moves everyone."),
      screen.getByLabelText('Olivia Walker has left'),
      at('Olivia Walker'),
      at('In the app'),
      screen.getByLabelText('Liam Hughes has left'),
      at('Liam Hughes'),
      screen.getByRole('radio', { name: /They've left/ }),
      screen.getByRole('radio', { name: /They're still members/ }),
      at('4 of 5 columns matched'),
      screen.getByRole('button', { name: 'See columns' }),
      at('03/04/2026 is read as 3 April 2026'),
      screen.getByRole('button', { name: 'Change to 4 March 2026' }),
      at('Card numbers not imported'),
      at('4 phone numbers look unusual'),
      at("2 rows weren't imported"),
      screen.getByRole('button', { name: 'See which' }),
      at('Your staff changed the phone number of 2 members in this app. This file has different ones:'),
      at('Ada Lovelace, Bo Chen'),
      screen.getByLabelText('Use the phone number from this file for all 2'),
      at('Or correct your file and import it again.'),
      screen.getByLabelText("These are Iron House Gym's members, and I have permission to store their details."),
      importButton(),
      at('Nobody is emailed.'),
    ]);
    // Each person's line says what each word is, and what the file says of them.
    const rows = screen.getAllByTestId('missing-row');
    expect(within(rows[0]).getByText('olivia@members.example')).toBeTruthy();
    expect(within(rows[0]).getByTestId('gone-facts').textContent).toBe('Status: Active · Membership: Gold · Payment: Paid');
    expect(within(rows[1]).getByTestId('gone-facts').textContent).toBe('Status: Cancelled · Membership: Gold · Payment: Paid');
    // Why? opens the warning's words, and See which names each row left out and why.
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
    expect(screen.getByText(/look like a normal number for their country/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See which' }));
    expect(at("Row 7, Walk-in Guest: no email or phone number, so they can't be matched or invited. Add one to your file to import them.")).toBeTruthy();
    expect(at("Row 9, Ada Lovelace: the same person as row 2, so they're imported once.")).toBeTruthy();
    // The columns open with every column, its example, what it imports as, and Never stored.
    fireEvent.click(screen.getByRole('button', { name: 'See columns' }));
    expect(screen.getByTestId('columns-note')).toBeTruthy();
    expect(within(screen.getByTestId('column-0')).getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByLabelText('Name imports as').value).toBe('fullName');
    expect(within(screen.getByTestId('column-3')).getByRole('button', { name: 'Change to 4 March 2026' })).toBeTruthy();
    expect(within(screen.getByTestId('column-4')).getByText('Never stored')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Status imports as'), { target: { value: 'dontKeep' } });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeTruthy();
    expect(at('Apply your column changes first.')).toBeTruthy();
  });

  it('a group opened by its tile shows its names, its note and Show more', async () => {
    await reviewWith(preview({ list: list({ new: 3, changed: 2, unchanged: 30, alreadyInApp: 1, noEmail: 1 }), mode: 'add' }));
    orgService.getMemberListRows.mockResolvedValueOnce(page('new', [person('Ada Lovelace', { inApp: true })], 3, 1));
    fireEvent.click(screen.getByRole('button', { name: /3\s*New/ }));
    const row = await screen.findByTestId('names-row');
    expect(within(row).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(row).getByText('ada@members.example · Active')).toBeTruthy();
    // One word for one thing (spec §18.3): "In the app", as on Members, never "Uses the app".
    expect(within(row).getByText('In the app')).toBeTruthy();
    expect(screen.getByText('1 already in the app · 1 have no email')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show more (2)' })).toBeTruthy();
  });

  it("the Updated names say what changes and for how many, in words (Kd, 2026-09-29)", async () => {
    await reviewWith(
      preview({
        list: list({ new: 0, changed: 29, unchanged: 30 }),
        mode: 'add',
        fieldChanges: [{ field: 'status', count: 27 }, { field: 'phone', count: 2 }],
        extraChanges: [{ key: 'locker', label: 'Locker', count: 1 }],
      }),
    );
    orgService.getMemberListRows.mockResolvedValueOnce(page('changed', [person('Ada Lovelace', { wasStatus: 'Active', status: 'Frozen' })], 29, 1));
    fireEvent.click(screen.getByRole('button', { name: /29\s*Updated/ }));
    expect(await screen.findByText('What changes: status for 27 · phone number for 2 · Locker for 1')).toBeTruthy();
    expect(within(screen.getByTestId('names-row')).getByText('ada@members.example · Active → Frozen')).toBeTruthy();
  });

  it('Done: what was imported, nobody emailed, Import another and Done', async () => {
    await reviewWith(preview());
    tickPermission();
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(importButton());
    const done = within(await screen.findByTestId('member-import-done'));
    inOrder([done.getByText('30 members imported'), done.getByText('Nobody has been emailed yet.'), done.getByRole('button', { name: 'Import another' }), done.getByRole('button', { name: 'Done' })]);
    fireEvent.click(done.getByRole('button', { name: 'Import another' }));
    expect(screen.getByRole('heading', { name: 'Import members' })).toBeTruthy();
    // Back on the way in it was used (Paste), emptied for the next file.
    expect(screen.getByLabelText('Paste your rows').value).toBe('');
  });
});

describe('app members leaving with nobody else missing (the question as before)', () => {
  it('"Keep them" reads the same file again as people to add', async () => {
    orgService.getMemberListRows.mockResolvedValueOnce(page('members_leaving', [person('Amy Shaw', { inApp: true })], 2));
    await reviewWith(preview({ list: list({ unchanged: 5 }), members: { leaving: 2, listedNow: 4 } }));
    const sent = orgService.uploadMemberList.mock.calls[0][1].contentBase64;
    orgService.uploadMemberList.mockResolvedValueOnce({
      data: { preview: preview({ uploadId: UPLOAD_ADD, mode: 'add', list: list({ unchanged: 5 }), guard: { ...calm, listSize: 30 } }) },
    });
    fireEvent.click(screen.getByRole('radio', { name: /They're still members/ }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1]).toMatchObject({ contentBase64: sent, mode: 'add' });
    await waitFor(() => expect(screen.getByRole('radio', { name: /They're still members/ }).getAttribute('aria-checked')).toBe('true'));
    tickPermission();
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer({ uploadId: UPLOAD_ADD }) } });
    fireEvent.click(importButton());
    await screen.findByTestId('member-import-done');
    expect(orgService.confirmMemberList).toHaveBeenCalledWith(GYM, UPLOAD_ADD, {
      permissionConfirmed: true,
      acknowledgeLargeChange: false,
      acknowledgeHandEdits: false,
    });
  });

  it('app members leaving with nobody else missing: their names, in words true for them', async () => {
    orgService.getMemberListRows.mockResolvedValueOnce(page('members_leaving', [person('Amy Shaw', { inApp: true })], 2, 1));
    await reviewWith(preview({ list: list({ unchanged: 5 }), members: { leaving: 2, listedNow: 4 } }));
    expect(screen.getByText("2 members who use the app aren't in this file")).toBeTruthy();
    const card = within(screen.getByTestId('missing'));
    await waitFor(() => expect(namesRows(card)).toHaveLength(1));
    expect(namesRows(card)[0].textContent).toContain('Amy Shaw');
    expect(card.getByRole('button', { name: 'Show more (1)' })).toBeTruthy();
    // The hint about leavers is about the list's own people, not about app members.
    expect(card.queryByTestId('missing-help')).toBeNull();
    expect(orgService.getMemberListRows).toHaveBeenCalledWith(GYM, UPLOAD, 'members_leaving', 0);
    expect(screen.getByRole('radio', { name: /They've left/ }).textContent).toContain('Mark them as not on your list');
  });

  it('Swap cannot be pressed twice while the file is being read', async () => {
    await reviewWith(
      preview({ dateColumns: [{ column: 3, field: 'joinedOn', order: 'dayFirst', from: 'country', example: { raw: '03/04/2026', read: '2026-04-03' }, notRead: 0 }] }),
    );
    orgService.uploadMemberList.mockReturnValueOnce(new Promise(() => {}));
    const swap = screen.getByRole('button', { name: 'Change to 4 March 2026' });
    fireEvent.click(swap);
    await waitFor(() => expect(swap.disabled).toBe(true));
    fireEvent.click(swap);
    expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2);
  });
});

describe('a first import', () => {
  it('is one big number, asks nothing about missing people, and waits for the permission tick', async () => {
    await reviewWith(preview());
    const hero = within(screen.getByTestId('hero'));
    expect(hero.getByText('30')).toBeTruthy();
    expect(hero.getByText('new members')).toBeTruthy();
    expect(screen.queryByTestId('missing')).toBeNull();
    expect(orgService.getMemberListRows).not.toHaveBeenCalled();
    expect(importButton().textContent).toBe('Import 30 members');
    expect(importButton().disabled).toBe(true);
    tickPermission();
    expect(importButton().disabled).toBe(false);
  });

  it('"See who" opens the names', async () => {
    await reviewWith(preview());
    orgService.getMemberListRows.mockResolvedValueOnce(page('new', [person('Ada Lovelace', { status: null })], 30, 1));
    fireEvent.click(screen.getByRole('button', { name: 'See who' }));
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(orgService.getMemberListRows).toHaveBeenCalledWith(GYM, UPLOAD, 'new', 0);
    expect(screen.getByRole('button', { name: 'Show more (29)' })).toBeTruthy();
  });

  it('beside the new members, everyone already on your list, and See who opens them (Kd, 2026-09-29)', async () => {
    await reviewWith(preview({ list: list({ new: 3, unchanged: 35, canBeInvited: 3 }) }));
    const hero = within(screen.getByTestId('hero'));
    expect(within(hero.getByTestId('hero-new')).getByText('3')).toBeTruthy();
    expect(within(hero.getByTestId('hero-new')).getByText('new members')).toBeTruthy();
    const already = within(hero.getByTestId('hero-already'));
    expect(already.getByText('35')).toBeTruthy();
    expect(already.getByText('already on your list')).toBeTruthy();
    orgService.getMemberListRows.mockResolvedValueOnce(page('unchanged', [person('Ada Lovelace')], 35, 1));
    fireEvent.click(already.getByRole('button', { name: 'See who' }));
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(orgService.getMemberListRows).toHaveBeenCalledWith(GYM, UPLOAD, 'unchanged', 0);
    expect(already.getByRole('button', { name: 'Hide' })).toBeTruthy();
    // The button still names only the new people: nobody else changes.
    expect(importButton().textContent).toBe('Import 3 members');
  });

  it('shows the tiles, not one number, when people are also updated', async () => {
    await reviewWith(preview({ list: list({ new: 3, changed: 6, unchanged: 30 }), mode: 'add' }));
    expect(screen.queryByTestId('hero')).toBeNull();
    expect(screen.getByRole('button', { name: /3\s*New/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /6\s*Updated/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /30\s*Already on your list/ })).toBeTruthy();
    expect(importButton().textContent).toBe('Import');
  });
});

describe('reading a file or pasted rows', () => {
  it('sends pasted rows as UTF-8 with its byte-order mark, as the whole list', async () => {
    await reviewWith(preview());
    const body = orgService.uploadMemberList.mock.calls[0][1];
    expect(body.mode).toBe('whole_list');
    expect(body.mapping).toBeUndefined();
    const bytes = Uint8Array.from(atob(body.contentBase64), (c) => c.charCodeAt(0));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('Name\tEmail\nAda\tada@members.example');
    expect(screen.getByText('Pasted rows')).toBeTruthy();
  });

  it('reads a chosen file', async () => {
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview({ file: counts({ dataRows: 3 }) }) } });
    renderBox();
    const file = new File(['Name,Email\nAda,ada@members.example'], 'members.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('member-file'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'Review' });
    expect(atob(orgService.uploadMemberList.mock.calls[0][1].contentBase64)).toBe('Name,Email\nAda,ada@members.example');
    expect(screen.getByText('members.csv')).toBeTruthy();
    expect(screen.getByText('3 rows')).toBeTruthy();
  });

  it('reads a file dropped on the box', async () => {
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    renderBox();
    const file = new File(['Name,Email\nBo,bo@members.example'], 'dropped.csv', { type: 'text/csv' });
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [file] } });
    await screen.findByRole('heading', { name: 'Review' });
    expect(atob(orgService.uploadMemberList.mock.calls[0][1].contentBase64)).toBe('Name,Email\nBo,bo@members.example');
  });

  it("prints the server's refusal as sent", async () => {
    orgService.uploadMemberList.mockRejectedValueOnce(refusal(422, { error: 'old_excel', message: 'This is an old Excel file (.xls). Save it as .xlsx or CSV and upload that.' }));
    renderBox();
    fireEvent.click(screen.getByRole('tab', { name: 'Paste rows' }));
    fireEvent.change(screen.getByLabelText('Paste your rows'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('This is an old Excel file (.xls). Save it as .xlsx or CSV and upload that.')).toBeTruthy();
  });

  it('Back and Change return to Upload with the pasted rows still there', async () => {
    await reviewWith(preview());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Import members' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Paste rows' }));
    expect(screen.getByLabelText('Paste your rows').value).toBe('Name\tEmail\nAda\tada@members.example');
  });

  it('the X closes the box', async () => {
    renderBox();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the checks', () => {
  it('names a column that is never imported, and it cannot be switched on', async () => {
    await reviewWith(preview());
    expect(screen.getByText('Card numbers not imported')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See columns' }));
    const card = within(screen.getByTestId('column-4'));
    expect(card.getByText('Never stored')).toBeTruthy();
    expect(card.queryByRole('combobox')).toBeNull();
  });

  it("a changed column is sent back as staff's mapping, and Import waits until it is applied", async () => {
    await reviewWith(preview());
    fireEvent.click(screen.getByRole('button', { name: 'See columns' }));
    fireEvent.change(screen.getByLabelText('Status imports as'), { target: { value: 'membershipType' } });
    tickPermission();
    expect(importButton().disabled).toBe(true);
    expect(screen.getByText('Apply your column changes first.')).toBeTruthy();
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].mapping).toMatchObject({ status: null, membershipType: 2 });
  });

  it('a date nothing in the file settled says how it was read, and the other reading is one press away, and back', async () => {
    const joined = (order, read) => [{ column: 3, field: 'joinedOn', order, from: order === 'dayFirst' ? 'country' : 'chosen', example: { raw: '03/04/2026', read }, notRead: 0 }];
    await reviewWith(preview({ dateColumns: joined('dayFirst', '2026-04-03') }));
    expect(screen.getByText('03/04/2026 is read as 3 April 2026')).toBeTruthy();
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview({ dateColumns: joined('monthFirst', '2026-03-04') }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Change to 4 March 2026' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].mapping.dateOrder).toEqual([{ column: 3, order: 'monthFirst' }]);
    // Read the other way, the line says so, and the same place puts it back.
    expect(await screen.findByText('03/04/2026 is read as 4 March 2026')).toBeTruthy();
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview({ dateColumns: joined('dayFirst', '2026-04-03') }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Change to 3 April 2026' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(3));
    expect(orgService.uploadMemberList.mock.calls[2][1].mapping.dateOrder).toEqual([{ column: 3, order: 'dayFirst' }]);
  });

  it('says how many of the columns it understood, and where the examples come from', async () => {
    await reviewWith(preview());
    expect(screen.getByTestId('columns-line').textContent).toContain('4 of 5 columns matched');
    fireEvent.click(within(screen.getByTestId('columns-line')).getByRole('button', { name: 'See columns' }));
    expect(screen.getByTestId('columns-note').textContent).toBe('Examples are from the first row of your file.');
  });

  it('a date the file itself settled is not asked about', async () => {
    await reviewWith(
      preview({
        dateColumns: [{ column: 3, field: 'joinedOn', order: 'dayFirst', from: 'file', example: { raw: '25/12/2025', read: '2025-12-25' }, notRead: 0 }],
      }),
    );
    expect(screen.queryByText('25/12/2025 is read as 25 December 2025')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Change to/ })).toBeNull();
  });

  it('a warning is one short line, with the whole sentence behind "Why?"', async () => {
    await reviewWith(preview({ warnings: [{ code: 'phones_unusual', rows: 30 }] }));
    expect(screen.getByText('30 phone numbers look unusual')).toBeTruthy();
    expect(screen.queryByText(/look like a normal number for their country/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
    expect(screen.getByText(/look like a normal number for their country/)).toBeTruthy();
  });

  it('a file with no email or phone column cannot be imported until the columns are picked', async () => {
    await reviewWith(preview({ needsMapping: true, list: list() }));
    expect(screen.getByText('No email or phone column found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
    expect(screen.getByLabelText('Name imports as')).toBeTruthy();
  });
});

describe('Import and its refusals', () => {
  it('says what was imported, and that nobody was emailed', async () => {
    await reviewWith(preview());
    tickPermission();
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(importButton());
    const done = within(await screen.findByTestId('member-import-done'));
    expect(done.getByText('30 members imported')).toBeTruthy();
    expect(done.getByText('Nobody has been emailed yet.')).toBeTruthy();
    expect(onImported).toHaveBeenCalledTimes(1);
    fireEvent.click(done.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an update says what changed', async () => {
    await reviewWith(preview({ list: list({ new: 3, changed: 6, unchanged: 30 }), mode: 'add' }));
    tickPermission();
    orgService.confirmMemberList.mockResolvedValueOnce({
      data: { confirmed: confirmedAnswer({ applied: list({ new: 3, changed: 6, unchanged: 30, gone: 2 }) }) },
    });
    fireEvent.click(importButton());
    const done = within(await screen.findByTestId('member-import-done'));
    expect(done.getByText('Your list is updated')).toBeTruthy();
    expect(done.getByText('3 new · 6 updated · 2 marked as past members')).toBeTruthy();
  });

  it('a 409 hand_edits asks the second tick, and sends it', async () => {
    await reviewWith(preview());
    tickPermission();
    orgService.confirmMemberList.mockRejectedValueOnce(
      // As the server sends it: field names, never a person's name, in a refusal.
      refusal(409, {
        error: 'hand_edits',
        message: 'This file would replace details your staff typed in here.',
        handEdits: { entries: 3, fields: ['phone number', 'membership type'], names: [] },
      }),
    );
    fireEvent.click(importButton());
    const tick = await screen.findByLabelText('Use the phone number and membership type from this file for all 3');
    expect(screen.getByText('Your staff changed the phone number and membership type of 3 members in this app. This file has different ones.')).toBeTruthy();
    expect(importButton().disabled).toBe(true);
    fireEvent.click(tick);
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(importButton());
    await screen.findByTestId('member-import-done');
    expect(orgService.confirmMemberList.mock.calls[1][2]).toEqual({ permissionConfirmed: true, acknowledgeLargeChange: false, acknowledgeHandEdits: true });
  });

  it("several people's details staff typed: the first three by name, and N more, and See all names everyone", async () => {
    await reviewWith(
      preview({ handEdits: { entries: 5, fields: ['phone number', 'membership type'], names: ['Ada Lee', 'Bo Chen', 'Cy Diaz', 'Di Evans', 'Ed Fox'] } }),
    );
    const box = within(screen.getByTestId('hand-edits'));
    expect(box.getByText('Your staff changed the phone number and membership type of 5 members in this app. This file has different ones:')).toBeTruthy();
    expect(box.getByTestId('hand-edit-names').textContent).toBe('Ada Lee, Bo Chen, Cy Diaz and 2 more · See all');
    fireEvent.click(box.getByRole('button', { name: 'See all' }));
    expect(box.getByTestId('hand-edit-names').textContent).toBe('Ada Lee, Bo Chen, Cy Diaz, Di Evans, Ed Fox');
    expect(box.getByLabelText('Use the phone number and membership type from this file for all 5')).toBeTruthy();
  });

  it("one person's details staff typed: the sentence names them and what, and Import waits for the tick", async () => {
    await reviewWith(preview({ handEdits: { entries: 1, fields: ['phone number'], names: ['Olivia Bennett'] } }));
    tickPermission();
    const box = within(screen.getByTestId('hand-edits'));
    expect(box.getByText("Olivia Bennett's phone number was changed by your staff in this app. This file has a different one.")).toBeTruthy();
    expect(box.queryByTestId('hand-edit-names')).toBeNull();
    expect(importButton().disabled).toBe(true);
    fireEvent.click(box.getByLabelText('Use the phone number from this file'));
    expect(importButton().disabled).toBe(false);
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(importButton());
    await screen.findByTestId('member-import-done');
    expect(orgService.confirmMemberList.mock.calls[0][2]).toEqual({ permissionConfirmed: true, acknowledgeLargeChange: false, acknowledgeHandEdits: true });
  });

  it('a list changed meanwhile offers to read the same file again', async () => {
    await reviewWith(preview());
    const sent = orgService.uploadMemberList.mock.calls[0][1].contentBase64;
    tickPermission();
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, { error: 'list_changed', message: 'Your list changed while you were looking at this preview, so nothing was applied.', baseVersion: 1, version: 2 }),
    );
    fireEvent.click(importButton());
    expect(await screen.findByText(/Your list changed while you were looking/)).toBeTruthy();
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    fireEvent.click(screen.getByRole('button', { name: 'Read the file again' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].contentBase64).toBe(sent);
  });
});
