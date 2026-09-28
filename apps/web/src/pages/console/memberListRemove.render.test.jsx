// Remove on the people selected (spec Part 3 §18.5, §18.6; ROADMAP 5b-v-b-ii): the bar's
// Remove opens a box naming who moves to past members, who loses the app and who doesn't
// change, and the press removes exactly them. The worst thing, first: the bar's Remove
// asking about, or removing, somebody who was not ticked.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MEMBER_LIST_SELECTION_CHANGED_WORDS, MEMBER_REMOVE_CHANGED_WORDS, memberListEntriesPageSchema, memberListViewSchema, memberRemovePreviewSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getApplications: vi.fn(),
      getNotMe: vi.fn(),
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getInvitePreview: vi.fn(),
      selectAllMembers: vi.fn(),
      previewRemoveSelected: vi.fn(),
      removeSelected: vi.fn(),
      previewRemoveRoster: vi.fn(),
      removeRoster: vi.fn(),
    },
  };
});
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }) }));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const MemberListPanel = (await import('./MemberListPanel')).default;
const Members = (await import('./Members')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', it: 'gym' };
const GYM_ROW = { id: GYM, name: 'Iron House Gym', slug: 'iron-house', timezone: 'Europe/London' };
const DIGEST = 'a'.repeat(64);
const DIGEST2 = 'b'.repeat(64);

const view = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 3, inApp: 1, canBeInvited: 2, noEmail: 0, former: 2 },
  statuses: [{ label: 'Active', count: 3, inApp: 1, canBeInvited: 2 }],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [],
  appWords: [{ word: 'not_in_app', count: 2 }, { word: 'in_app', count: 1 }],
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
const pageOf = (entries) => ({ data: { page: memberListEntriesPageSchema.parse({ total: entries.length, entries, cursor: null }) } });
const who = (name, entryId = null, userId = null) => ({ name, entryId, userId });
const box = (over = {}) => ({ data: { preview: memberRemovePreviewSchema.parse({ selected: 1, move: [], endApp: [], kept: [], movingNotInApp: 0, large: null, digest: DIGEST, ...over }) } });
const refusedWith = (error, preview) => ({ response: { status: 409, data: { error, message: error === 'remove_changed' ? MEMBER_REMOVE_CHANGED_WORDS : 'Tick the box', preview } } });

let ada;
let ben;
let cara;

const draw = (props = {}) => render(<MemberListPanel gymId={GYM} gym={GYM_ROW} words={WORDS} readOnly={false} refreshKey={0} {...props} />);
const tickOf = (name) => screen.getByRole('checkbox', { name: `Select ${name}` });
const bar = () => within(screen.getByTestId('sel-bar'));

beforeEach(() => {
  vi.resetAllMocks();
  resetConsoleOrgs();
  ada = entry('Ada Lovelace');
  ben = entry('Ben Carter', { inApp: true, app: { word: 'in_app', tone: 'green', at: null, line: null, lineTone: 'plain' } });
  cara = entry('Cara Diaz');
  orgService.getMemberList.mockResolvedValue({ data: { list: view } });
  orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben, cara]));
  orgService.getInvitePreview.mockResolvedValue({ data: { preview: { version: 3, reach: 2, skipped: { noEmail: 0, underAge: 0, inApp: 0, alreadyInvited: 0, unsubscribed: 0, bounced: 0, refused: 0, sharedAddress: 0 }, blocked: null } } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Remove from the bar', () => {
  it('the worst thing: the box asks about, and Remove removes, only the people ticked', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ben Carter'));
    fireEvent.click(tickOf('Cara Diaz'));
    orgService.previewRemoveSelected.mockResolvedValue(
      box({ selected: 2, movingNotInApp: 1, move: [who('Ben Carter', ben.entryId), who('Cara Diaz', cara.entryId)], endApp: [who('Ben Carter', ben.entryId, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001')] }),
    );
    orgService.removeSelected.mockResolvedValue({ data: { removed: { moved: 2, endedApp: 1, alreadyRemoved: false } } });
    fireEvent.click(bar().getByTestId('bar-remove'));

    const dialog = within(await screen.findByTestId('remove-box'));
    const ticked = { kind: 'ticked', entryIds: [ben.entryId, cara.entryId] };
    expect(orgService.previewRemoveSelected).toHaveBeenCalledWith(GYM, ticked);
    expect((await dialog.findByTestId('remove-selected')).textContent).toBe('You selected 2 members.');
    expect(dialog.getByTestId('remove-move').textContent).toContain('2 will move to past members');
    expect(within(dialog.getByTestId('remove-names-move')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ben Carter', 'Cara Diaz']);
    expect(within(dialog.getByTestId('remove-names-endApp')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ben Carter']);
    expect(dialog.getByTestId('remove-endApp').textContent).toContain(
      "Only people who use the app lose access. The other 1 doesn't use the app, so only their details move. They keep their own workouts and the free app, and the app tells them they're no longer a member of Iron House Gym.",
    );

    fireEvent.click(dialog.getByRole('button', { name: 'Remove 2 members' }));
    await waitFor(() => expect(orgService.removeSelected).toHaveBeenCalledTimes(1));
    expect(orgService.removeSelected).toHaveBeenCalledWith(GYM, ticked, DIGEST, false);
    expect((await dialog.findByTestId('remove-done')).textContent).toBe('2 members moved to past members. 1 person lost access to the app.');
    // Nobody else was ever asked about.
    for (const call of [...orgService.previewRemoveSelected.mock.calls, ...orgService.removeSelected.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(ada.entryId);
    }
    // The list behind is read again, and nobody is selected any more.
    await waitFor(() => expect(screen.queryByTestId('sel-bar')).toBeNull());
    expect(orgService.getMemberListEntries.mock.calls.length).toBeGreaterThan(1);
  });

  it('when people changed under the box, nothing is removed: the new box is shown, and the next press carries its digest', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Cara Diaz'));
    orgService.previewRemoveSelected.mockResolvedValue(box({ move: [who('Cara Diaz', cara.entryId)] }));
    const fresh = memberRemovePreviewSchema.parse({
      selected: 1,
      move: [who('Cara Diaz', cara.entryId)],
      endApp: [who('Cara Diaz', cara.entryId, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002')],
      kept: [],
      movingNotInApp: 0,
      large: null,
      digest: DIGEST2,
    });
    orgService.removeSelected.mockRejectedValueOnce(refusedWith('remove_changed', fresh));
    fireEvent.click(bar().getByTestId('bar-remove'));
    const dialog = within(await screen.findByTestId('remove-box'));
    await dialog.findByTestId('remove-move');
    expect(dialog.queryByTestId('remove-endApp')).toBeNull();

    fireEvent.click(dialog.getByRole('button', { name: 'Remove 1 member' }));
    expect((await dialog.findByTestId('remove-note')).textContent).toBe(MEMBER_REMOVE_CHANGED_WORDS);
    // She joined the app in between: now named as losing it.
    expect(within(dialog.getByTestId('remove-names-endApp')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Cara Diaz']);
    expect(dialog.queryByTestId('remove-done')).toBeNull();

    orgService.removeSelected.mockResolvedValue({ data: { removed: { moved: 1, endedApp: 1, alreadyRemoved: false } } });
    fireEvent.click(dialog.getByRole('button', { name: 'Remove 1 member' }));
    await waitFor(() => expect(orgService.removeSelected).toHaveBeenCalledTimes(2));
    expect(orgService.removeSelected.mock.calls[1]).toEqual([GYM, { kind: 'ticked', entryIds: [cara.entryId] }, DIGEST2, false]);
  });

  it('a big removal waits for its own tick, and the press carries it', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ben Carter'));
    orgService.previewRemoveSelected.mockResolvedValue(box({ move: [who('Ben Carter', ben.entryId)], large: { kind: 'app', removing: 60, of: 146 } }));
    orgService.removeSelected.mockResolvedValue({ data: { removed: { moved: 1, endedApp: 0, alreadyRemoved: false } } });
    fireEvent.click(bar().getByTestId('bar-remove'));
    const dialog = within(await screen.findByTestId('remove-box'));
    const pressBtn = await dialog.findByTestId('remove-press');
    expect(pressBtn.disabled).toBe(true);
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Yes, remove 60 of your 146 members in the app.' }));
    expect(pressBtn.disabled).toBe(false);
    fireEvent.click(pressBtn);
    await waitFor(() => expect(orgService.removeSelected).toHaveBeenCalledWith(GYM, { kind: 'ticked', entryIds: [ben.entryId] }, DIGEST, true));
  });

  it('who does not change is named, a reason a line; with nobody to remove there is no Remove button', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    orgService.previewRemoveSelected.mockResolvedValue(
      box({
        move: [],
        kept: [
          { reason: 'staff', people: [who('Coach Dee', null, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003')] },
          { reason: 'own_record', people: [who('Maria Park', 'aaaaaaaa-aaaa-4aaa-8aaa-000000009999', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004')] },
          { reason: 'gone', people: [who('', ada.entryId)] },
        ],
      }),
    );
    fireEvent.click(bar().getByTestId('bar-remove'));
    const dialog = within(await screen.findByTestId('remove-box'));
    expect((await dialog.findByTestId('remove-kept')).textContent).toContain("3 won't change");
    expect(dialog.getByTestId('remove-kept-staff').textContent).toBe('Owner and staff keep the app. Manage staff in Settings.Coach Dee');
    expect(dialog.getByTestId('remove-kept-own_record').textContent).toBe("Keep the app: they're on your list with their own details.Maria Park");
    expect(dialog.getByTestId('remove-kept-gone').textContent).toBe('1 · No longer on your list.');
    expect(dialog.queryByTestId('remove-press')).toBeNull();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('many names: the first five, "and N more", then See all', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    const many = Array.from({ length: 12 }, (_, i) => who(`Person ${String(i + 1).padStart(2, '0')}`, `aaaaaaaa-aaaa-4aaa-8aaa-${String(500 + i).padStart(12, '0')}`));
    orgService.previewRemoveSelected.mockResolvedValue(box({ selected: 12, move: many }));
    fireEvent.click(bar().getByTestId('bar-remove'));
    const dialog = within(await screen.findByTestId('remove-box'));
    const names = () => within(dialog.getByTestId('remove-names-move')).getAllByRole('listitem');
    await dialog.findByTestId('remove-names-move');
    expect(names()).toHaveLength(5);
    expect(dialog.getByTestId('remove-move').textContent).toContain('and 7 more · See all');
    fireEvent.click(dialog.getByRole('button', { name: 'See all' }));
    expect(names()).toHaveLength(12);
  });

  it('a Select all that moved: nothing done, the box says so and is read again for the new people', async () => {
    orgService.getMemberListEntries.mockResolvedValue({ data: { page: memberListEntriesPageSchema.parse({ total: 312, entries: [ada, ben, cara], cursor: null }) } });
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every member on this page' }));
    orgService.selectAllMembers.mockResolvedValue({ data: { selection: { count: 312, digest: DIGEST } } });
    fireEvent.click(await screen.findByTestId('select-everyone'));
    await screen.findByText('All 312 members are selected.');
    orgService.previewRemoveSelected
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'selection_changed', message: MEMBER_LIST_SELECTION_CHANGED_WORDS, count: 313, digest: DIGEST2 } } })
      .mockResolvedValue(box({ selected: 313, move: [who('Ada Lovelace', ada.entryId)] }));
    fireEvent.click(bar().getByTestId('bar-remove'));
    const dialog = within(await screen.findByTestId('remove-box'));
    await dialog.findByTestId('remove-move');
    expect(orgService.previewRemoveSelected).toHaveBeenCalledTimes(2);
    expect(orgService.previewRemoveSelected.mock.calls[1][1]).toMatchObject({ kind: 'all', count: 313, digest: DIGEST2 });
    expect(dialog.getByTestId('remove-note').textContent).toBe(MEMBER_LIST_SELECTION_CHANGED_WORDS);
  });

  it('a read-only gym has no Remove in the bar', async () => {
    draw({ readOnly: true });
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ben Carter'));
    expect(bar().queryByTestId('bar-remove')).toBeNull();
    expect(bar().getByTestId('bar-download')).toBeTruthy();
  });
});

describe('Remove on In the app', () => {
  const ORG = {
    id: GYM,
    slug: 'iron-house',
    name: 'Iron House Gym',
    city: 'Leeds',
    orgType: 'gym',
    timezone: 'Europe/London',
    locale: 'en',
    currencyDisplay: 'GBP',
    status: 'active',
    staffRole: 'owner',
    isMember: true,
    joinedAt: '2026-08-18T09:00:00.000Z',
  };
  const seat = (userId, displayName) => ({ userId, displayName, joinedAt: '2026-09-01T09:00:00.000Z', groupLabel: null, complimentary: false, takesSeat: true });
  const drawRoster = () =>
    render(
      <MemoryRouter initialEntries={['/console/iron-house/members?view=app']}>
        <Routes>
          <Route path="/console/:orgSlug/members" element={<Members />} />
        </Routes>
      </MemoryRouter>,
    );

  beforeEach(() => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
    orgService.getApplications.mockResolvedValue({ data: { items: [], nextCursor: null, pendingCount: 0 } });
    orgService.getNotMe.mockResolvedValue({ data: { items: [] } });
    orgService.getMembers.mockResolvedValue({ data: { items: [seat('bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 'Rita Sen'), seat('bbbbbbbb-bbbb-4bbb-8bbb-000000000006', 'Sam Roy'), seat('bbbbbbbb-bbbb-4bbb-8bbb-000000000007', 'Una Stay')], nextCursor: null } });
  });

  it('the worst thing: the box asks about, and Remove removes, only the people ticked', async () => {
    drawRoster();
    await screen.findByText('Sam Roy');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Rita Sen' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sam Roy' }));
    orgService.previewRemoveRoster.mockResolvedValue(box({ selected: 2, endApp: [who('Rita Sen', null, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000005'), who('Sam Roy', null, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006')] }));
    orgService.removeRoster.mockResolvedValue({ data: { removed: { moved: 0, endedApp: 2, alreadyRemoved: false } } });
    fireEvent.click(within(screen.getByTestId('roster-sel-bar')).getByTestId('roster-bar-remove'));
    const dialog = within(await screen.findByTestId('remove-box'));
    expect(orgService.previewRemoveRoster).toHaveBeenCalledWith(GYM, ['bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006']);
    expect((await dialog.findByTestId('remove-selected')).textContent).toBe('You selected 2 people in the app.');
    fireEvent.click(dialog.getByRole('button', { name: 'Remove 2 from the app' }));
    await waitFor(() => expect(orgService.removeRoster).toHaveBeenCalledWith(GYM, ['bbbbbbbb-bbbb-4bbb-8bbb-000000000005', 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006'], DIGEST, false));
    expect((await dialog.findByTestId('remove-done')).textContent).toBe('2 removed from the app.');
    expect(JSON.stringify([...orgService.previewRemoveRoster.mock.calls, ...orgService.removeRoster.mock.calls])).not.toContain('bbbbbbbb-bbbb-4bbb-8bbb-000000000007');
  });

  it('a trainer has no tick boxes', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer', privileges: ['members.read'] }] } });
    drawRoster();
    await screen.findByText('Sam Roy');
    expect(screen.queryByRole('checkbox', { name: 'Select Sam Roy' })).toBeNull();
  });
});
