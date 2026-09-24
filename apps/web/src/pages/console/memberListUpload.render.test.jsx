// Importing a member list (ROADMAP 5a). The server decides everything; these prove the
// box shows what matters and sends back exactly what staff answered.
//
// THE WORST THING THIS SCREEN COULD DO: let staff import the wrong file and take real
// people off the gym's list without ever seeing whose names. So the first test: the
// people missing from the file are named before anything can be imported, nothing is
// picked for staff, and a large change waits for the typed number.
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
  status: 'Active', wasStatus: null, inApp: false, ...over,
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
  render(<MemberListUpload gymId={GYM} words={WORDS} readOnly={false} onClose={onClose} onImported={onImported} />);
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
const tickPermission = () => fireEvent.click(screen.getByLabelText("I have permission to store these members' details."));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('the worst thing: a wrong file cannot take people off unseen', () => {
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

  it('names who is missing, picks nothing, and waits for the typed number', async () => {
    orgService.getMemberListRows.mockResolvedValueOnce(
      page('gone', [person('Olivia Walker', { inApp: true }), person('Liam Hughes'), person('Emma Price')], 25),
    );
    await reviewWith(wrongFile());

    const card = within(screen.getByTestId('missing'));
    expect(card.getByText("25 of your 30 members aren't in this file")).toBeTruthy();
    // Said once: no "Missing" tile beside the question, and never "No changes" above it.
    expect(screen.queryByText('Missing')).toBeNull();
    expect(screen.queryByText('No changes')).toBeNull();
    expect(screen.getByText('5 already up to date')).toBeTruthy();
    expect(await card.findByText(/Olivia Walker, Liam Hughes, Emma Price and 22 more/)).toBeTruthy();
    expect(card.getByTestId('missing-statuses').textContent).toBe('Active 20 · Frozen 5');
    expect(orgService.getMemberListRows).toHaveBeenCalledWith(GYM, UPLOAD, 'gone', 0);

    // Nothing is chosen for staff.
    expect(card.getByRole('radio', { name: /They've left/ }).getAttribute('aria-checked')).toBe('false');
    expect(card.getByRole('radio', { name: /They're still members/ }).getAttribute('aria-checked')).toBe('false');
    tickPermission();
    expect(importButton().disabled).toBe(true);

    // Every name can be read before answering, and who uses the app is marked.
    fireEvent.click(card.getByRole('button', { name: 'See all' }));
    expect(card.getByText('Uses the app')).toBeTruthy();

    fireEvent.click(card.getByRole('radio', { name: /They've left/ }));
    expect(importButton().disabled).toBe(true);
    const box = screen.getByLabelText('Type the number to confirm');
    fireEvent.change(box, { target: { value: '12' } });
    expect(importButton().disabled).toBe(true);
    fireEvent.change(box, { target: { value: '25' } });
    expect(importButton().disabled).toBe(false);

    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(importButton());
    await screen.findByTestId('member-import-done');
    expect(orgService.confirmMemberList).toHaveBeenCalledWith(GYM, UPLOAD, {
      permissionConfirmed: true,
      acknowledgeLargeChange: true,
      acknowledgeHandEdits: false,
    });
  });

  it('"Keep them" reads the same file again as people to add, and "They\'ve left" goes back', async () => {
    orgService.getMemberListRows.mockResolvedValueOnce(page('gone', [person('Olivia Walker')], 25));
    await reviewWith(wrongFile());
    const sent = orgService.uploadMemberList.mock.calls[0][1].contentBase64;

    orgService.uploadMemberList.mockResolvedValueOnce({
      data: { preview: preview({ uploadId: UPLOAD_ADD, mode: 'add', list: list({ unchanged: 5 }), guard: { ...calm, listSize: 30 } }) },
    });
    fireEvent.click(screen.getByRole('radio', { name: /They're still members/ }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1]).toMatchObject({ contentBase64: sent, mode: 'add' });

    // The question stays answered, with no number to type, and nobody goes.
    await waitFor(() => expect(screen.getByRole('radio', { name: /They're still members/ }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByLabelText('Type the number to confirm')).toBeNull();
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

  it('changing the answer back to "They\'ve left" reads the file as the whole list again', async () => {
    orgService.getMemberListRows.mockResolvedValue(page('gone', [person('Olivia Walker')], 25));
    await reviewWith(wrongFile());
    orgService.uploadMemberList.mockResolvedValueOnce({
      data: { preview: preview({ uploadId: UPLOAD_ADD, mode: 'add', list: list({ unchanged: 5 }) }) },
    });
    fireEvent.click(screen.getByRole('radio', { name: /They're still members/ }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /They're still members/ }).getAttribute('aria-checked')).toBe('true'));

    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: wrongFile() } });
    fireEvent.click(screen.getByRole('radio', { name: /They've left/ }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(3));
    expect(orgService.uploadMemberList.mock.calls[2][1].mode).toBe('whole_list');
    await waitFor(() => expect(screen.getByRole('radio', { name: /They've left/ }).getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByLabelText('Type the number to confirm')).toBeTruthy();
  });

  it('a few missing still need an answer, but no typed number', async () => {
    orgService.getMemberListRows.mockResolvedValueOnce(page('gone', [person('Ben Cole'), person('Amy Shaw')], 2));
    await reviewWith(preview({ list: list({ new: 3, changed: 6, unchanged: 30, gone: 2 }), guard: { ...calm, entriesGoing: 2, listSize: 38 } }));
    expect(screen.getByText("2 members aren't in this file")).toBeTruthy();
    expect(await screen.findByText(/Ben Cole, Amy Shaw/)).toBeTruthy();
    tickPermission();
    expect(importButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /They've left/ }));
    expect(screen.queryByLabelText('Type the number to confirm')).toBeNull();
    expect(importButton().disabled).toBe(false);
  });
});

describe('an answer is only ever about the people staff were shown (review of PR #106)', () => {
  const oneMissing = (over = {}) =>
    preview({ list: list({ unchanged: 4, gone: 1 }), guard: { ...calm, entriesGoing: 1, listSize: 5 }, ...over });
  const nineMissing = () =>
    preview({ uploadId: UPLOAD_ADD, list: list({ unchanged: 4, gone: 9 }), guard: { ...calm, entriesGoing: 9, listSize: 13 } });
  const radios = () => [screen.getByRole('radio', { name: /They've left/ }), screen.getByRole('radio', { name: /They're still members/ })];

  it('"They\'ve left" is asked again after "Read the file again" finds other people missing', async () => {
    orgService.getMemberListRows.mockResolvedValue(page('gone', [person('Ben Cole')], 1));
    await reviewWith(oneMissing());
    fireEvent.click(screen.getByRole('radio', { name: /They've left/ }));
    tickPermission();
    orgService.confirmMemberList.mockRejectedValueOnce(
      refusal(409, { error: 'list_changed', message: 'Your list changed while you were looking at this preview, so nothing was applied.', baseVersion: 1, version: 2 }),
    );
    fireEvent.click(importButton());
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: nineMissing() } });
    fireEvent.click(await screen.findByRole('button', { name: 'Read the file again' }));
    await screen.findByText("9 members aren't in this file");
    expect(orgService.uploadMemberList.mock.calls[1][1].mode).toBe('whole_list');
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(importButton().disabled).toBe(true);
  });

  it('"They\'ve left" is asked again after "Apply changes"', async () => {
    orgService.getMemberListRows.mockResolvedValue(page('gone', [person('Ben Cole')], 1));
    await reviewWith(oneMissing());
    fireEvent.click(screen.getByRole('radio', { name: /They've left/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.change(screen.getByLabelText('Status imports as'), { target: { value: 'membershipType' } });
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: nineMissing() } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await screen.findByText("9 members aren't in this file");
    tickPermission();
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(importButton().disabled).toBe(true);
  });

  it('after "They\'re still members", other columns read the file as the whole list and ask again', async () => {
    orgService.getMemberListRows.mockResolvedValue(page('gone', [person('Ben Cole')], 1));
    await reviewWith(oneMissing());
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview({ uploadId: UPLOAD_ADD, mode: 'add', list: list({ unchanged: 4 }) }) } });
    fireEvent.click(screen.getByRole('radio', { name: /They're still members/ }));
    await waitFor(() => expect(radios()[1].getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.change(screen.getByLabelText('Status imports as'), { target: { value: 'membershipType' } });
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: nineMissing() } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await screen.findByText("9 members aren't in this file");
    expect(orgService.uploadMemberList.mock.calls[2][1].mode).toBe('whole_list');
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
  });

  it('"They\'ve left" pressed after "They\'re still members" holds only if the same number are missing', async () => {
    orgService.getMemberListRows.mockResolvedValue(page('gone', [person('Ben Cole')], 1));
    await reviewWith(oneMissing());
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview({ uploadId: UPLOAD_ADD, mode: 'add', list: list({ unchanged: 4 }) }) } });
    fireEvent.click(screen.getByRole('radio', { name: /They're still members/ }));
    await waitFor(() => expect(radios()[1].getAttribute('aria-checked')).toBe('true'));
    // Meanwhile a colleague typed people in: the whole list now leaves nine out, not one.
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: nineMissing() } });
    fireEvent.click(screen.getByRole('radio', { name: /They've left/ }));
    await screen.findByText("9 members aren't in this file");
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
  });

  it('app members leaving with nobody else missing: their names, in words true for them', async () => {
    orgService.getMemberListRows.mockResolvedValueOnce(page('members_leaving', [person('Amy Shaw', { inApp: true })], 2));
    await reviewWith(preview({ list: list({ unchanged: 5 }), members: { leaving: 2, listedNow: 4 } }));
    expect(screen.getByText("2 members who use the app aren't in this file")).toBeTruthy();
    expect(await screen.findByText(/Amy Shaw and 1 more/)).toBeTruthy();
    expect(orgService.getMemberListRows).toHaveBeenCalledWith(GYM, UPLOAD, 'members_leaving', 0);
    expect(screen.getByRole('radio', { name: /They've left/ }).textContent).toContain('Mark them as not on your list');
  });

  it('the button names the new people only when nobody is moved to past members by it', async () => {
    orgService.getMemberListRows.mockResolvedValue(page('gone', [person('Ben Cole')], 2));
    await reviewWith(preview({ list: list({ new: 3, unchanged: 5, gone: 2 }), guard: { ...calm, entriesGoing: 2, listSize: 40 } }));
    fireEvent.click(screen.getByRole('radio', { name: /They've left/ }));
    expect(importButton().textContent).toBe('Import');
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview({ uploadId: UPLOAD_ADD, mode: 'add', list: list({ new: 3, unchanged: 5 }) }) } });
    fireEvent.click(screen.getByRole('radio', { name: /They're still members/ }));
    await waitFor(() => expect(importButton().textContent).toBe('Import 3 members'));
  });

  it('Swap cannot be pressed twice while the file is being read', async () => {
    await reviewWith(
      preview({ dateColumns: [{ column: 3, field: 'joinedOn', order: 'dayFirst', from: 'country', example: { raw: '03/04/2026', read: '2026-04-03' }, notRead: 0 }] }),
    );
    orgService.uploadMemberList.mockReturnValueOnce(new Promise(() => {}));
    const swap = screen.getByRole('button', { name: 'Swap' });
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

  it('shows the tiles, not one number, when people are also updated', async () => {
    await reviewWith(preview({ list: list({ new: 3, changed: 6, unchanged: 30 }), mode: 'add' }));
    expect(screen.queryByTestId('hero')).toBeNull();
    expect(screen.getByRole('button', { name: /3\s*New/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /6\s*Updated/ })).toBeTruthy();
    expect(screen.getByText('30 already up to date')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    const card = within(screen.getByTestId('column-4'));
    expect(card.getByText('Never stored')).toBeTruthy();
    expect(card.queryByRole('combobox')).toBeNull();
  });

  it("a changed column is sent back as staff's mapping, and Import waits until it is applied", async () => {
    await reviewWith(preview());
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.change(screen.getByLabelText('Status imports as'), { target: { value: 'membershipType' } });
    tickPermission();
    expect(importButton().disabled).toBe(true);
    expect(screen.getByText('Apply your column changes first.')).toBeTruthy();
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].mapping).toMatchObject({ status: null, membershipType: 2 });
  });

  it('a date nothing in the file settled is shown once, and Swap reads it the other way', async () => {
    await reviewWith(
      preview({
        dateColumns: [{ column: 3, field: 'joinedOn', order: 'dayFirst', from: 'country', example: { raw: '03/04/2026', read: '2026-04-03' }, notRead: 0 }],
      }),
    );
    expect(screen.getByText('03/04/2026 = 3 April 2026')).toBeTruthy();
    orgService.uploadMemberList.mockResolvedValueOnce({ data: { preview: preview() } });
    fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
    await waitFor(() => expect(orgService.uploadMemberList).toHaveBeenCalledTimes(2));
    expect(orgService.uploadMemberList.mock.calls[1][1].mapping.dateOrder).toEqual([{ column: 3, order: 'monthFirst' }]);
  });

  it('a date the file itself settled is not asked about', async () => {
    await reviewWith(
      preview({
        dateColumns: [{ column: 3, field: 'joinedOn', order: 'dayFirst', from: 'file', example: { raw: '25/12/2025', read: '2025-12-25' }, notRead: 0 }],
      }),
    );
    expect(screen.queryByText('25/12/2025 = 25 December 2025')).toBeNull();
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
      refusal(409, { error: 'hand_edits', message: 'This file would replace details your staff typed in here.', handEdits: { entries: 3, fields: ['phone number', 'membership type'] } }),
    );
    fireEvent.click(importButton());
    const tick = await screen.findByLabelText('Replace what staff typed for 3 people (phone number, membership type)');
    expect(importButton().disabled).toBe(true);
    fireEvent.click(tick);
    orgService.confirmMemberList.mockResolvedValueOnce({ data: { confirmed: confirmedAnswer() } });
    fireEvent.click(importButton());
    await screen.findByTestId('member-import-done');
    expect(orgService.confirmMemberList.mock.calls[1][2]).toEqual({ permissionConfirmed: true, acknowledgeLargeChange: false, acknowledgeHandEdits: true });
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
