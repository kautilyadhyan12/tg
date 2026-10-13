// Members opened from Overview's Last 7 days box (ROADMAP 20d-ii): "See who" beside
// Payment due lands on the list already showing them, and the address stops asking.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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
      getMembershipWords: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Members = (await import('./Members')).default;

const GYM = '11111111-1111-1111-1111-111111111111';
const ORG = {
  id: GYM,
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  country: 'US',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'owner',
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
};

function Address() {
  const { pathname, search } = useLocation();
  return <output data-testid="address">{pathname + search}</output>;
}
const draw = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Address />
      <Routes>
        <Route path="/console/:orgSlug/members" element={<Members />} />
      </Routes>
    </MemoryRouter>,
  );
const address = () => screen.getByTestId('address').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
  orgService.getApplications.mockResolvedValue({ data: { items: [], nextCursor: null, pendingCount: 0 } });
  orgService.getNotMe.mockResolvedValue({ data: { items: [] } });
  orgService.getMembershipWords.mockResolvedValue({ data: { words: [], types: [] } });
  orgService.getMemberList.mockResolvedValue({
    data: {
      list: {
        hasList: true,
        version: 1,
        lastConfirmedAt: '2026-09-20T10:00:00.000Z',
        counts: { entries: 12, inApp: 0, canBeInvited: 12, noEmail: 0, former: 3 },
        statuses: [],
        membershipTypes: [],
        paymentStatuses: [],
        fields: [],
        appWords: [],
      },
    },
  });
  orgService.getMemberListEntries.mockResolvedValue({ data: { page: { total: 0, entries: [], cursor: null } } });
});

afterEach(() => cleanup());

describe("Members opened from Overview's Payment due row", () => {
  it('"?show=payment-due" reads only the people with a payment due, and the address stops asking', async () => {
    draw('/console/iron-house/members?show=payment-due');
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'paymentStatus=Payment+due'));
    expect(orgService.getMemberListEntries).not.toHaveBeenCalledWith(GYM, '');
    expect(within(await screen.findByTestId('showing')).getByRole('button', { name: 'Stop showing only Payment due' })).toBeTruthy();
    await waitFor(() => expect(address()).toBe('/console/iron-house/members'));
  });

  it('"?show=past-payment-due" reads the past members who still owe', async () => {
    draw('/console/iron-house/members?show=past-payment-due');
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'records=former&paymentStatus=Payment+due'));
    const showing = within(await screen.findByTestId('showing'));
    expect(showing.getByRole('button', { name: 'Stop showing only Past members' })).toBeTruthy();
    expect(showing.getByRole('button', { name: 'Stop showing only Payment due' })).toBeTruthy();
    await waitFor(() => expect(address()).toBe('/console/iron-house/members'));
  });

  it('a word the page does not know opens the whole list, and the rest of the address stays', async () => {
    draw('/console/iron-house/members?show=everything&look=light');
    await waitFor(() => expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, ''));
    await waitFor(() => expect(address()).toBe('/console/iron-house/members?look=light'));
    expect(screen.queryByTestId('showing')).toBeNull();
  });
});
