// THE MENU'S COUNTS AND THE BELL, drawn in the console's shell (V1-d).
//
// The worst thing on the screen: a count or a line the server did not send, or a bell that
// says "Nothing needs attention" to somebody who may see none of it. Then: the bell opens the
// list from any page, each line opens its place, and the counts follow what is read again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getMine: vi.fn() } };
});
const changes = new Set();
vi.mock('../../api/attentionApi', () => ({
  attentionService: { get: vi.fn() },
  onConsoleChange: (listener) => {
    changes.add(listener);
    return () => changes.delete(listener);
  },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { attentionService } = await import('../../api/attentionApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const More = (await import('./More')).default;

const BASE = '/console/iron-house';
const gym = (staffRole, privileges) => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  country: 'US',
  status: 'active',
  staffRole,
  isMember: false,
  privileges,
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: 200 },
});
const NONE = { chargebacks: null, failedPayments: null, paymentDue: null, refunds: null, appPayments: null, appCancels: null, newLeads: null, atRisk: null, reported: null };
const BUSY = {
  chargebacks: { count: 0, lostCount: 0, needsReconnect: false, canReconnect: true },
  failedPayments: { count: 3, totals: [{ currency: 'USD', minor: 6000 }] },
  paymentDue: { count: 6, past: 1 },
  refunds: { count: 0 },
  appPayments: { count: 0, more: false },
  appCancels: { count: 0 },
  newLeads: { count: 5 },
  atRisk: { count: 2 },
  reported: { posts: 1, comments: 0 },
};

function Where() {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="where">{`${pathname}${search}${hash}`}</p>;
}

async function open(path, privileges = ROLE_PRIVILEGES.owner, staffRole = 'owner') {
  orgService.getMine.mockResolvedValue({ data: { orgs: [gym(staffRole, privileges)] } });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/console/:orgSlug/more" element={<ConsoleLayout><More /></ConsoleLayout>} />
        <Route path="/console/:orgSlug/*" element={<ConsoleLayout><Where /></ConsoleLayout>} />
      </Routes>
    </MemoryRouter>,
  );
  await within(screen.getByTestId('console-rail')).findByText('Iron House');
}
const rail = () => within(screen.getByTestId('console-rail'));
const bar = () => within(screen.getByTestId('console-bar'));
const countBeside = (name) => {
  const link = rail().getByRole('link', { name: new RegExp(`^${name}\\b`) });
  return link.querySelector('[data-testid="menu-count"]')?.textContent ?? null;
};

beforeEach(() => {
  resetConsoleOrgs();
  changes.clear();
  attentionService.get.mockReset();
});
afterEach(() => cleanup());

describe('the counts and the bell', () => {
  it('THE WORST THING: before the answer, and for somebody who may see no part, no count and no bell', async () => {
    let answer;
    attentionService.get.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await open(`${BASE}/members`, []);
    expect(screen.queryAllByTestId('menu-count')).toHaveLength(0);
    expect(screen.queryByTestId('console-bell')).toBeNull();
    await act(async () => answer(NONE));
    expect(screen.queryAllByTestId('menu-count')).toHaveLength(0);
    expect(screen.queryByTestId('console-bell')).toBeNull();
    expect(screen.queryByText('Nothing needs attention')).toBeNull();
  });

  it('a count beside each page where something waits, none elsewhere, and the bell with the number of kinds', async () => {
    attentionService.get.mockResolvedValue(BUSY);
    await open(`${BASE}/members`);
    await waitFor(() => expect(countBeside('Overview')).toBe('5'));
    expect(countBeside('Leads')).toBe('5');
    expect(countBeside('At risk')).toBe('2');
    expect(countBeside('Failed payments')).toBe('3');
    expect(countBeside('Updates')).toBe('1');
    for (const page of ['Attendance', 'Classes', 'Sell', 'Memberships', 'Events', 'Reports', 'Settings']) expect(countBeside(page), page).toBeNull();
    // A screen reader hears it with the page's name.
    expect(rail().getByRole('link', { name: 'Leads, 5 waiting' })).toBeTruthy();
    const bells = screen.getAllByTestId('console-bell');
    // One in the bar across the top, one in the phone's top bar.
    expect(bells).toHaveLength(2);
    for (const bell of bells) expect(bell.getAttribute('aria-label')).toBe('Needs attention: 5 things need attention');
    // The phone's tabs: Overview's count on its tab, and what waits under More on More.
    const tabs = within(screen.getByTestId('console-tabbar'));
    expect(tabs.getByRole('link', { name: /Overview/ }).querySelector('[data-testid="menu-count"]').textContent).toBe('5');
    expect(tabs.getByRole('link', { name: /More/ }).querySelector('[data-testid="menu-count"]').textContent).toBe('11');
  });

  it('the bell opens Needs attention under itself, and each line opens its place', async () => {
    attentionService.get.mockResolvedValue(BUSY);
    await open(`${BASE}/sell`);
    await waitFor(() => expect(countBeside('Overview')).toBe('5'));
    fireEvent.click(bar().getByTestId('console-bell'));
    const box = within(screen.getByRole('dialog', { name: 'Needs attention' }));
    expect(box.getAllByTestId('attention-line').map((l) => l.textContent)).toEqual([
      '3 failed card paymentsDeclined, still outstanding$60.00View',
      '6 members with a payment duePlus 1 past memberView',
      '2 members at riskStopped comingView',
      '1 reported postKeep or remove each oneView',
      '5 new leadsNot contacted yetView',
    ]);
    // Opening it read again.
    expect(attentionService.get).toHaveBeenCalledTimes(2);
    fireEvent.click(box.getByRole('link', { name: 'View: 5 new leads' }));
    expect(screen.getByTestId('where').textContent).toBe(`${BASE}/leads?status=new`);
    expect(screen.queryByRole('dialog', { name: 'Needs attention' })).toBeNull();
  });

  it('with nothing waiting the bell has no count and says so in green', async () => {
    attentionService.get.mockResolvedValue({ ...BUSY, failedPayments: { count: 0, totals: [] }, paymentDue: null, newLeads: { count: 0 }, atRisk: { count: 0 }, reported: { posts: 0, comments: 0 } });
    await open(`${BASE}/members`);
    await waitFor(() => expect(bar().getByTestId('console-bell').getAttribute('aria-label')).toBe('Needs attention: nothing needs attention'));
    expect(screen.queryAllByTestId('menu-count')).toHaveLength(0);
    fireEvent.click(bar().getByTestId('console-bell'));
    expect(within(screen.getByRole('dialog', { name: 'Needs attention' })).getByText('Nothing needs attention')).toBeTruthy();
  });

  it('read again on another page once 30 seconds old, and at once after staff change something; another business never shows', async () => {
    attentionService.get.mockResolvedValue(BUSY);
    await open(`${BASE}/members`);
    await waitFor(() => expect(countBeside('Leads')).toBe('5'));
    attentionService.get.mockResolvedValue({ ...BUSY, newLeads: { count: 4 } });
    // Another page within 30 seconds of the last read: not read again.
    const first = attentionService.get.mock.calls.length;
    fireEvent.click(rail().getByRole('link', { name: /^Attendance/ }));
    await act(async () => undefined);
    expect(attentionService.get.mock.calls.length).toBe(first);
    // Another page once it is 30 seconds old: read again.
    const later = Date.now() + 31_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    fireEvent.click(rail().getByRole('link', { name: /^Classes/ }));
    await waitFor(() => expect(countBeside('Leads')).toBe('4'));
    expect(attentionService.get.mock.calls.length).toBe(first + 1);
    clock.mockRestore();
    // Check-ins alone, with the last read under 30 s old: not read again.
    vi.useFakeTimers();
    const quiet = attentionService.get.mock.calls.length;
    act(() => {
      for (const l of changes) l('visit');
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(attentionService.get.mock.calls.length).toBe(quiet);
    // A change accepted anywhere, even with a check-in straight after it: one read once its writes have landed.
    attentionService.get.mockResolvedValue({ ...BUSY, newLeads: { count: 0 } });
    act(() => {
      for (const l of changes) l('change');
      for (const l of changes) l('visit');
    });
    const before = attentionService.get.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();
    expect(attentionService.get.mock.calls.length).toBe(before + 1);
    await waitFor(() => expect(countBeside('Leads')).toBeNull());
    for (const call of attentionService.get.mock.calls) expect(call[0]).toBe('11111111-1111-4111-8111-111111111111');
  });

  it("More on a phone: each page's count beside it", async () => {
    attentionService.get.mockResolvedValue(BUSY);
    await open(`${BASE}/more`);
    const more = within(screen.getByTestId('console-more'));
    await waitFor(() => expect(more.getByRole('link', { name: /^Leads/ }).querySelector('[data-testid="menu-count"]')?.textContent).toBe('5'));
    expect(more.getByRole('link', { name: /^Failed payments/ }).querySelector('[data-testid="menu-count"]').textContent).toBe('3');
    expect(more.getByRole('link', { name: /^Sell/ }).querySelector('[data-testid="menu-count"]')).toBeNull();
  });
});
