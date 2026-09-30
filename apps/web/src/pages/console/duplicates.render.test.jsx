// Possible duplicates (ROADMAP 5b-iv-a; RULINGS 2026-09-25, 2026-09-30): a sign atop Members,
// a page of pairs, and each pair opened side by side with Merge and Different people.
//
// The worst thing on these screens is two different people joined: a pair opened showing
// another pair's person, or Merge or Different people sending records other than the two on
// screen. Opening Bea's pair compares exactly Bea's two records, and each press sends those.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { memberListDuplicatesPageSchema, memberListEntriesPageSchema, memberListEntryDetailSchema, memberListEntryWrittenSchema, memberListViewSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getMemberListEntry: vi.fn(),
      getMemberListDuplicates: vi.fn(),
      markDifferentPeople: vi.fn(),
      mergeMemberListEntries: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const MemberListPanel = (await import('./MemberListPanel')).default;
const MembersDuplicates = (await import('./MembersDuplicates')).default;
const { pairWhyWords, duplicatesSignWords } = await import('./memberListPeople');

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA_1 = 'a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADA_2 = 'a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEA_1 = 'b1b1b1b1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BEA_2 = 'b2b2b2b2-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', personCap: 'Member', it: 'gym' };

const view = (duplicates) =>
  memberListViewSchema.parse({
    hasList: true,
    version: 3,
    lastConfirmedAt: '2026-09-20T10:00:00.000Z',
    counts: { entries: 4, inApp: 0, canBeInvited: 4, noEmail: 0, former: 0 },
    statuses: [{ label: 'Active', count: 4, inApp: 0, canBeInvited: 4 }],
    membershipTypes: [],
    paymentStatuses: [],
    fields: [],
    appWords: [],
    duplicates,
  });

const record = (entryId, fullName, contact) => ({
  entryId,
  fullName,
  email: contact.email ?? null,
  phone: contact.phone ?? null,
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
  needsReview: false,
});
const detail = (entryId, fullName, contact) =>
  memberListEntryDetailSchema.parse({ ...record(entryId, fullName, contact), extra: [], handEdited: [], members: [], review: [] });

const RECORDS = {
  [ADA_1]: detail(ADA_1, 'Ada Lovelace', { email: 'ada@members.example' }),
  [ADA_2]: detail(ADA_2, 'Lovelace, Ada', { phone: '+447700900111' }),
  [BEA_1]: detail(BEA_1, 'Bea Hart', { email: 'bea@members.example' }),
  [BEA_2]: detail(BEA_2, 'Beatrice Hart', { phone: '+447700900222' }),
};
const side = (id, past = false) => {
  const r = RECORDS[id];
  return { entryId: id, fullName: r.fullName, email: r.email, phone: r.phone, memberNumber: null, past };
};
const ADA_PAIR = { first: side(ADA_1), second: side(ADA_2), sameName: true, samePhone: false, sameMemberNumber: false };
const BEA_PAIR = { first: side(BEA_1), second: side(BEA_2, true), sameName: false, samePhone: true, sameMemberNumber: false };
const pairsPage = (pairs, total = pairs.length, cursor = null) => ({ data: { page: memberListDuplicatesPageSchema.parse({ total, pairs, cursor }) } });

const gymRow = {
  id: GYM,
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  country: 'US',
  status: 'active',
  staffRole: 'owner',
  isMember: false,
  privileges: ['members.read', 'members.confirm'],
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: 200 },
};

const drawPage = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/members/duplicates']}>
      <Routes>
        <Route path="/console/:orgSlug/members/duplicates" element={<MembersDuplicates />} />
        <Route path="/console/:orgSlug/members" element={<p>the members page</p>} />
      </Routes>
    </MemoryRouter>,
  );
const pairRows = () => screen.findAllByTestId('duplicate-pair');
const person = () => within(screen.getByTestId('member-person'));

beforeEach(() => {
  vi.resetAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [gymRow] } });
  orgService.getMemberList.mockResolvedValue({ data: { list: view({ count: 2 }) } });
  orgService.getMemberListEntries.mockResolvedValue({
    data: { page: memberListEntriesPageSchema.parse({ total: 0, entries: [], cursor: null }) },
  });
  orgService.getMemberListEntry.mockImplementation((_gym, id) => Promise.resolve({ data: { entry: RECORDS[id] } }));
});

afterEach(() => cleanup());

describe('a pair opened side by side', () => {
  it("the worst thing: Bea's pair compares Bea's two records, and Different people sends exactly those two", async () => {
    orgService.getMemberListDuplicates.mockResolvedValueOnce(pairsPage([ADA_PAIR, BEA_PAIR])).mockResolvedValue(pairsPage([ADA_PAIR]));
    orgService.markDifferentPeople.mockResolvedValue({ data: { duplicates: { count: 1 } } });
    drawPage();
    fireEvent.click((await pairRows())[1]);
    const compare = within(await person().findByTestId('merge-compare'));
    expect(compare.getByTestId('join-first-fullName').textContent).toBe('Bea Hart');
    expect(compare.getByTestId('join-second-fullName').textContent).toBe('Beatrice Hart');
    expect(person().getByTestId('pair-why').textContent).toBe('These two may be the same member: same phone.');
    // Both of Bea's records were read, and nobody else's.
    expect(orgService.getMemberListEntry.mock.calls.map((c) => c[1]).sort()).toEqual([BEA_1, BEA_2]);

    fireEvent.click(person().getByTestId('different-people'));
    await waitFor(() => expect(orgService.markDifferentPeople).toHaveBeenCalledWith(GYM, [BEA_1, BEA_2]));
    expect(orgService.mergeMemberListEntries).not.toHaveBeenCalled();
    // The panel closes and the page is read again, without Bea's pair.
    await waitFor(() => expect(screen.queryByTestId('member-person')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('duplicate-pair')).toHaveLength(1));
  });

  it('Merge sends the two records on screen: the column chosen kept, the other removed', async () => {
    orgService.getMemberListDuplicates.mockResolvedValue(pairsPage([ADA_PAIR]));
    orgService.mergeMemberListEntries.mockResolvedValue({
      data: memberListEntryWrittenSchema.parse({ outcome: 'merged', entry: RECORDS[ADA_1], version: 4 }),
    });
    drawPage();
    fireEvent.click((await pairRows())[0]);
    const compare = within(await person().findByTestId('merge-compare'));
    expect(compare.getByTestId('join-first-fullName').textContent).toBe('Ada Lovelace');
    expect(person().getByRole('button', { name: 'Merge' }).disabled).toBe(true);
    fireEvent.click(person().getByTestId('keep-first'));
    // The preview says what the one record will hold: Ada's own email, and her phone from the other.
    const after = within(person().getByTestId('merge-preview'));
    expect(after.getByTestId('after-email').textContent).toBe('ada@members.example');
    expect(after.queryByTestId('after-phone')).toBeNull();
    expect(after.getByTestId('lost-phone').textContent).toContain('+447700900111');
    fireEvent.click(person().getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(orgService.mergeMemberListEntries).toHaveBeenCalledWith(GYM, ADA_2, ADA_1, false));
    expect(orgService.markDifferentPeople).not.toHaveBeenCalled();
  });

  it('Different people is offered only on the pair the panel was opened on', async () => {
    orgService.getMemberListDuplicates.mockResolvedValue(pairsPage([ADA_PAIR]));
    drawPage();
    fireEvent.click((await pairRows())[0]);
    await person().findByTestId('merge-compare');
    expect(person().getByTestId('different-people')).toBeTruthy();
    // Back to the search, and another record picked: that is an ordinary merge, not this pair.
    fireEvent.click(person().getByRole('button', { name: 'Back' }));
    expect(person().queryByTestId('different-people')).toBeNull();
  });
});

describe('the possible duplicates page', () => {
  it('lists each pair with what they share, both records and a past member tagged', async () => {
    orgService.getMemberListDuplicates.mockResolvedValue(pairsPage([ADA_PAIR, BEA_PAIR]));
    drawPage();
    const rows = await pairRows();
    expect(rows.map((r) => within(r).getByTestId('duplicate-why').textContent)).toEqual(['Same name', 'Same phone']);
    expect(rows[1].textContent).toContain('Bea Hart');
    expect(rows[1].textContent).toContain('Beatrice Hart');
    expect(within(rows[1]).getAllByText('Past member')).toHaveLength(1);
    expect(within(rows[0]).queryByText('Past member')).toBeNull();
    expect(screen.getByTestId('duplicates-total').textContent).toBe('2 possible duplicates');
  });

  it("when the gym's columns cannot be read, says so and opens no pair (it would leave out the custom fields)", async () => {
    orgService.getMemberListDuplicates.mockResolvedValue(pairsPage([ADA_PAIR]));
    orgService.getMemberList.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { list: view({ count: 1 }) } });
    drawPage();
    const row = (await pairRows())[0];
    expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy();
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(screen.queryByTestId('member-person')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /Try again/ })[0]);
    await waitFor(() => expect(screen.getAllByTestId('duplicate-pair')[0].disabled).toBe(false));
  });

  it('brings the next fifty with Load more, after the ones already shown', async () => {
    orgService.getMemberListDuplicates.mockResolvedValueOnce(pairsPage([ADA_PAIR], 2, 'next')).mockResolvedValueOnce(pairsPage([BEA_PAIR], 2, null));
    drawPage();
    await pairRows();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByTestId('duplicate-pair')).toHaveLength(2));
    expect(orgService.getMemberListDuplicates).toHaveBeenLastCalledWith(GYM, 'next');
  });

  it('with no pairs left says so, never that no two records share anything, with the way back to Members', async () => {
    orgService.getMemberListDuplicates.mockResolvedValue(pairsPage([]));
    drawPage();
    const none = await screen.findByTestId('duplicates-none');
    expect(none.textContent).toContain('No possible duplicates to review');
    expect(none.textContent).toContain("Pairs you marked as different people aren't shown again.");
    expect(none.textContent).not.toMatch(/share a name/);
    fireEvent.click(screen.getByRole('link', { name: 'Back to members' }));
    expect(await screen.findByText('the members page')).toBeTruthy();
  });
});

describe('the sign atop Members', () => {
  const drawPanel = () =>
    render(
      <MemoryRouter initialEntries={['/console/iron-house/members']}>
        <Routes>
          <Route path="/console/:orgSlug/members" element={<MemberListPanel gymId={GYM} words={WORDS} readOnly={false} refreshKey={0} />} />
          <Route path="/console/:orgSlug/members/duplicates" element={<p>the duplicates page</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('says how many, and Review goes to the page', async () => {
    drawPanel();
    const sign = await screen.findByTestId('duplicates-sign');
    expect(within(sign).getByText('2 possible duplicates')).toBeTruthy();
    fireEvent.click(within(sign).getByTestId('duplicates-review'));
    expect(await screen.findByText('the duplicates page')).toBeTruthy();
  });

  it('is not there when no pair is left', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: view({ count: 0 }) } });
    drawPanel();
    await screen.findByTestId('member-list-panel');
    await waitFor(() => expect(orgService.getMemberList).toHaveBeenCalled());
    expect(screen.queryByTestId('duplicates-sign')).toBeNull();
  });
});

describe('the words', () => {
  it('names what a pair shares', () => {
    const pair = (sameName, samePhone, sameMemberNumber) => ({ sameName, samePhone, sameMemberNumber });
    expect(
      [pair(true, false, false), pair(false, true, false), pair(false, false, true), pair(true, true, false), pair(true, true, true), pair(false, true, true)].map(pairWhyWords),
    ).toEqual(['Same name', 'Same phone', 'Same member number', 'Same name and phone', 'Same name, phone and member number', 'Same phone and member number']);
    // The count is of pairs, and says pairs: three records of one name are three pairs.
    expect(duplicatesSignWords(1)).toBe('1 possible duplicate');
    expect(duplicatesSignWords(3)).toBe('3 possible duplicates');
    expect(duplicatesSignWords(1200)).toBe('1,200 possible duplicates');
  });
});
