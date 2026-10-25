// PAYMENTS TO MATCH'S COUNT IN THE MENU (ROADMAP 18d-iii-b-ii-a). Every payment taken in Square Point of
// Sale waits for one press (Kd, 2026-10-25), so the desk sees one come in from any page: a count beside the
// menu's line, and beside it on the phone's More page. Only the network is mocked.
//
// The worst thing it could do: a count somebody who may not match is shown (or asked for), or a count left
// standing after the payment was matched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const svc = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock('../../api/paymentsToMatchApi', () => ({ paymentsToMatchService: svc }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getMine: vi.fn() } };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));
// The gym's open line has its own tests; here the test says what the server would tell, and sees who listens.
const live = vi.hoisted(() => ({ listeners: new Set() }));
vi.mock('./liveNews', async (importOriginal) => {
  const actual = await importOriginal();
  const { useEffect, useRef } = await import('react');
  return {
    ...actual,
    useLiveNews: (gymId, onMessage, active = true) => {
      const latest = useRef(onMessage);
      latest.current = onMessage;
      useEffect(() => {
        if (!active || !gymId) return undefined;
        const listener = { gymId, fn: (message) => latest.current(message) };
        live.listeners.add(listener);
        return () => live.listeners.delete(listener);
      }, [gymId, active]);
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const More = (await import('./More')).default;

const GYM = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  country: 'US',
  status: 'active',
  staffRole: 'owner',
  isMember: false,
  privileges: ['members.read', 'members.confirm', 'billing.members', 'org.manage'],
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: 200 },
};

const draw = (gym = GYM, path = '/console/iron-house') => {
  orgService.getMine.mockResolvedValue({ data: { orgs: [gym], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/console/:orgSlug" element={<ConsoleLayout><p>Overview</p></ConsoleLayout>} />
        <Route path="/console/:orgSlug/more" element={<More />} />
      </Routes>
    </MemoryRouter>,
  );
};
const menuLine = async () => within(await screen.findByTestId('console-rail')).findByRole('link', { name: /^Payments to match/ });

beforeEach(() => {
  resetConsoleOrgs();
  live.listeners.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Payments to match's count in the menu", () => {
  it('says how many wait, and follows the news: one taken in adds to it, one matched takes it away', async () => {
    svc.summary.mockResolvedValue({ count: 3, totals: [{ currency: 'USD', minor: 7500 }], used: true });
    draw();
    const line = await menuLine();
    await waitFor(() => expect(within(line).getByTestId('payments-to-match-count').textContent).toBe('3'));
    // A screen reader hears it after the page's name.
    expect(line.textContent.endsWith('Payments to match, 3 payments to match')).toBe(true);
    expect(svc.summary).toHaveBeenCalledWith(GYM.id);
    // A payment taken in at a desk: the server's news, and the count is read again.
    svc.summary.mockResolvedValue({ count: 4, totals: [{ currency: 'USD', minor: 10000 }], used: true });
    await act(async () => {
      for (const l of live.listeners) l.fn({ what: 'paymentsToMatch' });
    });
    await waitFor(() => expect(within(line).getByTestId('payments-to-match-count').textContent).toContain('4'));
    // All matched: no count at all, never a 0.
    svc.summary.mockResolvedValue({ count: 0, totals: [], used: true });
    await act(async () => {
      for (const l of live.listeners) l.fn({ what: 'paymentsToMatch' });
    });
    await waitFor(() => expect(within(line).queryByTestId('payments-to-match-count')).toBeNull());
  });

  it("a gym that has never taken a payment in Square Point of Sale opens no live line for it, and shows no count", async () => {
    svc.summary.mockResolvedValue({ count: 0, totals: [], used: false });
    draw();
    const line = await menuLine();
    await waitFor(() => expect(svc.summary).toHaveBeenCalledTimes(1));
    expect(within(line).queryByTestId('payments-to-match-count')).toBeNull();
    expect([...live.listeners].filter((l) => l.gymId === GYM.id)).toHaveLength(0);
  });

  it('somebody who may not match payments is never asked about, nor shown, a count', async () => {
    svc.summary.mockResolvedValue({ count: 3, totals: [], used: true });
    draw({ ...GYM, staffRole: 'trainer', privileges: ['members.read', 'attendance.read'] });
    await screen.findByTestId('console-rail');
    expect(within(screen.getByTestId('console-rail')).queryByRole('link', { name: /^Payments to match/ })).toBeNull();
    expect(svc.summary).not.toHaveBeenCalled();
  });

  it("the phone's More page shows the same count beside Payments to match", async () => {
    svc.summary.mockResolvedValue({ count: 2, totals: [], used: true });
    draw(GYM, '/console/iron-house/more');
    const more = await screen.findByTestId('console-more');
    const row = await within(more).findByRole('link', { name: /^Payments to match/ });
    await waitFor(() => expect(within(row).getByTestId('more-count').textContent).toBe('2 payments to match'));
  });
});
