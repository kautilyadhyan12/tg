// Review needed (ROADMAP 5b-v-d-iv; RULINGS 2026-09-29): an import's problems stay marked on
// the person. One tag on their Members row, what is wrong on their page with It's correct,
// a glowing sign atop Members naming who, and a glowing dot beside Members in the menu.
//
// The worst thing on these screens is somebody else's problem on a person's page, or a
// press clearing the wrong person's: Ada's page shows only Ada's lines, and It's correct
// sends Ada's record and the one line pressed.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { memberListEntriesPageSchema, memberListEntryDetailSchema, memberListViewSchema, memberListReviewWords } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getMemberListEntry: vi.fn(),
      reviewChecked: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const MemberListPanel = (await import('./MemberListPanel')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', personCap: 'Member', it: 'gym' };

const view = (review) =>
  memberListViewSchema.parse({
    hasList: true,
    version: 3,
    lastConfirmedAt: '2026-09-20T10:00:00.000Z',
    counts: { entries: 3, inApp: 0, canBeInvited: 3, noEmail: 0, former: 0 },
    statuses: [{ label: 'Active', count: 3, inApp: 0, canBeInvited: 3 }],
    membershipTypes: [],
    paymentStatuses: [],
    fields: [{ key: 'notes', label: 'Notes' }],
    appWords: [],
    review,
  });

const row = (entryId, fullName, needsReview) => ({
  entryId,
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
  needsReview,
});

const detail = (entryId, fullName, review) =>
  memberListEntryDetailSchema.parse({
    ...row(entryId, fullName, review.length > 0),
    extra: [{ key: 'notes', label: 'Notes', value: 'n'.repeat(500) }],
    handEdited: [],
    members: [],
    review,
  });

const ADA_LINES = [
  { problem: 'phone_unusual', field: 'phone', label: 'Phone' },
  { problem: 'cell_cut', field: 'extra:notes', label: 'Notes' },
];
const BEA_LINES = [{ problem: 'not_a_date', field: 'joinedOn', label: 'Join date' }];

const drawPanel = () => render(<MemberListPanel gymId={GYM} words={WORDS} readOnly={false} refreshKey={0} />);
const person = () => within(screen.getByTestId('member-person'));

beforeEach(() => {
  vi.resetAllMocks();
  resetConsoleOrgs();
  orgService.getMemberList.mockResolvedValue({
    data: { list: view({ count: 2, people: [{ entryId: ADA, fullName: 'Ada Lovelace' }, { entryId: BEA, fullName: 'Bea Hart' }] }) },
  });
  orgService.getMemberListEntries.mockResolvedValue({
    data: { page: memberListEntriesPageSchema.parse({ total: 3, entries: [row(ADA, 'Ada Lovelace', true), row(BEA, 'Bea Hart', true), row(CY, 'Cy Shah', false)], cursor: null }) },
  });
  orgService.getMemberListEntry.mockImplementation((_gym, id) =>
    Promise.resolve({ data: { entry: id === ADA ? detail(ADA, 'Ada Lovelace', ADA_LINES) : id === BEA ? detail(BEA, 'Bea Hart', BEA_LINES) : detail(CY, 'Cy Shah', []) } }),
  );
});

afterEach(() => cleanup());

describe("the worst thing: a person's page shows only their own problems, and It's correct clears only the one pressed", () => {
  it("Ada's page lists Ada's two lines, and It's correct on her phone sends Ada's record and that one line", async () => {
    orgService.reviewChecked.mockResolvedValue({ data: { entry: detail(ADA, 'Ada Lovelace', [ADA_LINES[1]]) } });
    drawPanel();
    const rows = await screen.findAllByTestId('list-row');
    fireEvent.click(rows[0]);
    const box = within(await person().findByTestId('review-box'));
    const lines = box.getAllByTestId('review-line').map((l) => l.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Phone');
    expect(lines[0]).toContain(memberListReviewWords('phone_unusual', 'phone'));
    expect(lines[1]).toContain('Notes');
    // Bea's problem is Bea's: nothing of it on Ada's page.
    expect(person().queryByText(memberListReviewWords('not_a_date', 'joinedOn'))).toBeNull();

    fireEvent.click(within(box.getAllByTestId('review-line')[0]).getByRole('button', { name: "It's correct" }));
    await waitFor(() => expect(orgService.reviewChecked).toHaveBeenCalledTimes(1));
    expect(orgService.reviewChecked).toHaveBeenCalledWith(GYM, ADA, { problem: 'phone_unusual', field: 'phone' });
    await waitFor(() => expect(within(person().getByTestId('review-box')).getAllByTestId('review-line')).toHaveLength(1));
    // The list is read again, so the sign and the tags follow.
    await waitFor(() => expect(orgService.getMemberList).toHaveBeenCalledTimes(2));
  });

  it('a person with nothing to review has no box', async () => {
    drawPanel();
    const rows = await screen.findAllByTestId('list-row');
    fireEvent.click(rows[2]);
    await waitFor(() => expect(orgService.getMemberListEntry).toHaveBeenCalledWith(GYM, CY));
    await person().findByText('cy@members.example');
    expect(person().queryByTestId('review-box')).toBeNull();
  });
});

describe('the Members list', () => {
  it('tags exactly the people the server marks, one tag each', async () => {
    drawPanel();
    const rows = await screen.findAllByTestId('list-row');
    expect(rows.map((r) => within(r).queryAllByTestId('review-tag').length)).toEqual([1, 1, 0]);
    expect(within(rows[0]).getByTestId('review-tag').textContent).toBe('Review needed');
  });

  it('the sign says how many, See who names them, and a name opens that person', async () => {
    drawPanel();
    const sign = within(await screen.findByTestId('review-sign'));
    expect(sign.getByText('2 members need review')).toBeTruthy();
    expect(sign.queryByTestId('review-names')).toBeNull();
    fireEvent.click(sign.getByRole('button', { name: 'See who' }));
    const names = within(sign.getByTestId('review-names'));
    expect(names.getAllByRole('button').map((b) => b.textContent)).toEqual(['Ada Lovelace', 'Bea Hart']);
    fireEvent.click(names.getByRole('button', { name: 'Bea Hart' }));
    const box = within(await person().findByTestId('review-box'));
    expect(box.getAllByTestId('review-line').map((l) => l.textContent)).toEqual([`Join date${memberListReviewWords('not_a_date', 'joinedOn')}It's correct`]);
  });

  it('more than the names shown says how many more are tagged in the list', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: view({ count: 73, people: [{ entryId: ADA, fullName: 'Ada Lovelace' }] }) } });
    drawPanel();
    const sign = within(await screen.findByTestId('review-sign'));
    fireEvent.click(sign.getByRole('button', { name: 'See who' }));
    expect(sign.getByText('and 72 more, each tagged Review needed in the list')).toBeTruthy();
  });

  it('with nobody to review there is no sign and no tag', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: view({ count: 0, people: [] }) } });
    orgService.getMemberListEntries.mockResolvedValue({
      data: { page: memberListEntriesPageSchema.parse({ total: 1, entries: [row(CY, 'Cy Shah', false)], cursor: null }) },
    });
    drawPanel();
    await screen.findAllByTestId('list-row');
    expect(screen.queryByTestId('review-sign')).toBeNull();
    expect(screen.queryByTestId('review-tag')).toBeNull();
  });
});

describe("the menu's dot", () => {
  const gym = (membersNeedReview) => ({
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
    membersNeedReview,
  });
  const drawShell = async (count) => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [gym(count)] } });
    render(
      <MemoryRouter initialEntries={['/console/iron-house']}>
        <Routes>
          <Route path="/console/:orgSlug" element={<ConsoleLayout><div /></ConsoleLayout>} />
        </Routes>
      </MemoryRouter>,
    );
    await within(screen.getByTestId('console-rail')).findByText('Iron House');
  };

  it('glows beside Members, and nowhere else, on the computer menu and the phone tabs', async () => {
    await drawShell(3);
    const rail = within(screen.getByTestId('console-rail')).getByRole('navigation', { name: 'Console' });
    const railLink = within(rail).getByRole('link', { name: /Members/ });
    expect(within(railLink).getAllByTestId('review-dot')).toHaveLength(1);
    expect(within(rail).getAllByTestId('review-dot')).toHaveLength(1);
    expect(railLink.textContent).toContain('3 members need review');
    const tabs = within(screen.getByTestId('console-tabbar'));
    expect(within(tabs.getByRole('link', { name: /Members/ })).getAllByTestId('review-dot')).toHaveLength(1);
    expect(tabs.getAllByTestId('review-dot')).toHaveLength(1);
  });

  it('is not there when nobody needs review', async () => {
    await drawShell(0);
    expect(screen.queryByTestId('review-dot')).toBeNull();
  });
});
