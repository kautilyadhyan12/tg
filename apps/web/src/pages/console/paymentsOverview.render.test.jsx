// PAYMENTS OVERVIEW, drawn (ROADMAP V1-f). Only the network is mocked: what staff see is read off
// the real page. The worst thing it could do: show somebody whose role gives them no money the
// business's revenue or who owes; and a Connect Square button to staff who cannot connect it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

const orgApi = { getMine: vi.fn(), getGymPayments: vi.fn(), getBillSettings: vi.fn(), getMemberList: vi.fn(), connectSquare: vi.fn() };
const register = { get: vi.fn() };
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('../../api/registerApi', () => ({ registerService: register }));

const PaymentsOverview = (await import('./PaymentsOverview')).default;
const { AttentionContext } = await import('./useAttention');
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: [...ROLE_PRIVILEGES.owner],
  timezone: 'America/Chicago',
  country: 'US',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const ZERO = { count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, upi: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, terminal: 0, app: 0, refundedMinor: 0, discountMinor: 0 };
const sellPage = (sells) => ({
  currency: 'USD',
  today: '2026-11-19',
  day: '2026-11-19',
  canSell: sells,
  canManage: true,
  totals: sells ? { ...ZERO, count: 2, payments: 2, totalMinor: 37000, cash: 30000, bank_transfer: 7000 } : ZERO,
  membershipTypes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  products: [],
  discounts: [],
  tax: { included: false, rates: [{ id: 'r', name: 'Sales tax', pcm: 8250 }] },
});
const CONNECTED = { state: 'connected', businessName: 'Iron House LLC', locationName: 'Austin', locations: [], connectedAt: '2026-10-01T10:00:00Z', removedAt: null };
const payments = (square, owner = true) => ({
  data: {
    payments: {
      availability: 'square',
      country: 'US',
      canConnect: owner,
      squareReady: true,
      square,
      terminals: square?.state === 'connected' ? { needsAllow: false, list: [{ id: 't1' }], pairing: null } : null,
      needsAllow: false,
      allowFor: [],
    },
  },
});
const ATTENTION = {
  chargebacks: { count: 0, lostCount: 0, needsReconnect: false, canReconnect: true },
  failedPayments: { count: 3, totals: [{ currency: 'USD', minor: 6000 }] },
  paymentDue: { count: 6, past: 0 },
  refunds: { count: 2 },
  appPayments: { count: 0, more: false },
  appCancels: { count: 1 },
  newLeads: { count: 5 },
  atRisk: { count: 2 },
  reported: null,
};

function Where() {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="where">{`${pathname}${search}${hash}`}</p>;
}

function open(org = ORG, attention = ATTENTION, openSquare = vi.fn()) {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/payments']}>
      <AttentionContext.Provider value={{ attention, counts: {}, reload: () => undefined, paymentSetup: false }}>
        <Routes>
          <Route path="/console/:orgSlug/payments" element={<PaymentsOverview openSquare={openSquare} />} />
          <Route path="/console/:orgSlug/*" element={<Where />} />
          <Route path="/console/:orgSlug" element={<Where />} />
        </Routes>
      </AttentionContext.Provider>
    </MemoryRouter>,
  );
  return openSquare;
}

beforeEach(() => {
  resetConsoleOrgs();
  register.get.mockResolvedValue(sellPage(true));
  orgApi.getGymPayments.mockResolvedValue(payments(CONNECTED));
  orgApi.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 0 } });
  orgApi.getMemberList.mockResolvedValue({ data: { list: { noCard: 14 } } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the worst thing: money only for whoever their role gives it to', () => {
  it('a trainer reads that their role has no payment pages, and nothing is asked', async () => {
    open({ ...ORG, staffRole: 'trainer', privileges: [...ROLE_PRIVILEGES.trainer] });
    await screen.findByTestId('payments-overview-refused');
    expect(screen.queryByText('Record a payment')).toBeNull();
    expect(orgApi.getGymPayments).not.toHaveBeenCalled();
    expect(register.get).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it('staff who keep the price list but take no payments see no revenue, no amount and nobody who owes', async () => {
    register.get.mockResolvedValue(sellPage(false));
    const keeper = { ...ORG, staffRole: 'manager', privileges: ['members.read', 'memberships.manage'] };
    const restricted = { ...ATTENTION, chargebacks: null, failedPayments: null, paymentDue: null, refunds: null, appPayments: null };
    open(keeper, restricted);
    await screen.findByTestId('pay-line-memberships');
    await waitFor(() => expect(within(screen.getByTestId('pay-line-memberships')).getByText('3 on your price list')).toBeTruthy());
    expect(screen.queryByText('Revenue today')).toBeNull();
    expect(screen.queryByTestId('pay-methods')).toBeNull();
    expect(screen.queryByTestId('pay-attention')).toBeNull();
    expect(screen.queryByText('Payment due')).toBeNull();
    expect(screen.queryByText('Record a payment')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$/);
    expect(orgApi.getMemberList).not.toHaveBeenCalled();
  });
});

describe('connected to Square', () => {
  it('the figures, Needs attention and every line, each opening its place', async () => {
    open();
    const revenue = await screen.findByTestId('pay-tile-revenue');
    expect(within(revenue).getByText('$370.00')).toBeTruthy();
    expect(within(revenue).getByText('4 payments')).toBeTruthy();
    expect(within(screen.getByTestId('pay-tile-failed')).getByText('$60.00 outstanding')).toBeTruthy();
    const attention = screen.getAllByTestId('pay-attention-line').map((l) => l.textContent);
    expect(attention).toEqual([expect.stringContaining('3 failed card payments'), expect.stringContaining('6 members with a payment due'), expect.stringContaining('2 refunds to review')]);
    expect(screen.getAllByTestId('pay-method').map((m) => m.textContent)).toEqual(['Cash$300.00', 'Bank transfer$70.00']);
    await waitFor(() => expect(screen.getByTestId('pay-line-cards').getAttribute('href')).toBe('/console/iron-house/members?show=no-card'));
    expect(orgApi.getMemberList).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('pay-line-square')).getByText('Connected')).toBeTruthy();
    expect(screen.queryByTestId('payment-setup')).toBeNull();
    fireEvent.click(screen.getByTestId('pay-line-square'));
    expect(screen.getByTestId('where').textContent).toBe('/console/iron-house/settings#payments');
  });

  it('Record a payment opens Payment due to pick the member, as search does', async () => {
    open();
    fireEvent.click(await screen.findByRole('link', { name: 'Record a payment' }));
    expect(screen.getByTestId('where').textContent).toBe('/console/iron-house/members?show=payment-due');
  });

  it('nothing waiting reads Nothing needs attention', async () => {
    const calm = { ...ATTENTION, failedPayments: { count: 0, totals: [] }, paymentDue: { count: 0, past: 0 }, refunds: { count: 0 } };
    open(ORG, calm);
    expect(await screen.findByTestId('pay-attention-none')).toBeTruthy();
  });

  it('a manager while Square needs reconnecting: the bell’s line, with no button, never "Nothing needs attention" (round one, H1)', async () => {
    const reconnect = { ...ATTENTION, chargebacks: { count: 0, lostCount: 0, needsReconnect: true, canReconnect: false }, failedPayments: { count: 0, totals: [] }, paymentDue: { count: 0, past: 0 }, refunds: { count: 0 } };
    orgApi.getGymPayments.mockResolvedValue(payments(CONNECTED, false));
    open({ ...ORG, staffRole: 'manager', privileges: [...ROLE_PRIVILEGES.manager] }, reconnect);
    const line = await screen.findByTestId('pay-attention-line');
    expect(line.textContent).toContain('Reconnect Square');
    expect(line.textContent).toContain('The owner needs to reconnect Square before chargebacks can show');
    expect(within(line).queryByRole('link')).toBeNull();
    expect(screen.queryByTestId('pay-attention-none')).toBeNull();
  });

  it('a read that fails says so once, and Try again reads again', async () => {
    orgApi.getBillSettings.mockRejectedValueOnce(new Error('down'));
    open();
    expect(await screen.findByText("Some figures couldn't load.")).toBeTruthy();
    const asked = orgApi.getBillSettings.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(orgApi.getBillSettings.mock.calls.length).toBe(asked + 1));
    await waitFor(() => expect(screen.queryByText("Some figures couldn't load.")).toBeNull());
  });
});

describe('before Square is connected', () => {
  it('the owner: Connect Square first, its three steps, and the press opens Square', async () => {
    orgApi.getGymPayments.mockResolvedValue(payments(null));
    orgApi.connectSquare.mockResolvedValue({ data: { url: 'https://squareup.com/oauth2/authorize?x' } });
    const openSquare = open();
    const box = await screen.findByTestId('payment-setup');
    expect(within(box).getByText('Connect Square to take card payments')).toBeTruthy();
    expect(within(box).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1Connect SquareSign in to Square and choose your location.',
      '2Pair a TerminalOptionalTake card payments at the front desk.',
      '3Request cards on fileAsk members to add a card for autopay.',
    ]);
    expect(within(screen.getByTestId('pay-tile-cards')).getByText('Available after Square is connected')).toBeTruthy();
    expect(orgApi.getMemberList).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole('button', { name: 'Connect Square' }));
    await waitFor(() => expect(openSquare).toHaveBeenCalledWith('https://squareup.com/oauth2/authorize?x'));
  });

  it('a manager reads who can connect it, with no button', async () => {
    orgApi.getGymPayments.mockResolvedValue(payments(null, false));
    open({ ...ORG, staffRole: 'manager', privileges: [...ROLE_PRIVILEGES.manager] });
    const box = await screen.findByTestId('payment-setup');
    expect(within(box).getByText('Only the owner of Iron House can connect Square.')).toBeTruthy();
    expect(within(box).queryByRole('button')).toBeNull();
  });

  it("Square's page could not be opened: said in the box", async () => {
    orgApi.getGymPayments.mockResolvedValue(payments(null));
    orgApi.connectSquare.mockRejectedValue(new Error('down'));
    open();
    fireEvent.click(within(await screen.findByTestId('payment-setup')).getByRole('button', { name: 'Connect Square' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
