// Managing a gym's paid plan on screen (ROADMAP Stage 3 item 1c-i): the plan card's
// button to Paddle's own page, the failed-payment banner, and the prompt that asks for
// the card once the 5-day grace has run out — never a second plan.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { attendanceDay, overview } from './__fixtures__/overview';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getCodes: vi.fn(),
      getApplications: vi.fn(),
      getOverview: vi.fn(),
      getAttendanceDay: vi.fn(),
      getPlans: vi.fn(),
      startCheckout: vi.fn(),
      syncCheckout: vi.fn(),
      startTrial: vi.fn(),
      openBillingPortal: vi.fn(),
    },
  };
});

vi.mock('../../utils/paddleCheckout', () => ({ openPaddleCheckout: vi.fn(), closePaddleCheckout: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const { setCurrentUserId } = await import('../../utils/storage');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Overview = (await import('./Overview')).default;

const GYM_ID = '11111111-1111-1111-1111-111111111111';
const PORTAL = 'https://sandbox-customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw';

const OWNER = {
  id: GYM_ID,
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
  privileges: ['members.read', 'codes.invite', 'codes.manage', 'members.confirm', 'members.remove', 'staff.manage', 'org.manage', 'billing.manage'],
  seatsUsed: 12,
  ownerTrialUsed: true,
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
  consoleReadOnly: false,
  paymentOverdue: false,
};
const TRAINER = { ...OWNER, staffRole: 'trainer', privileges: ['members.read', 'codes.invite'] };

const plan = (patch = {}) => ({
  status: 'active',
  trialEndsAt: null,
  seatCap: 500,
  priceLabel: '$129',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  ...patch,
});
const overdue = (org) => ({ ...org, subscription: null, consoleReadOnly: true, paymentOverdue: true });
const mineIs = (...orgs) => ({ data: { orgs, formerOrgs: [] } });

/** A stand-in for the tab `window.open` makes on the press. */
function fakeTab() {
  return { opener: 'the console', location: { replace: vi.fn() }, close: vi.fn() };
}

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={['/console/iron-house']}>
      <Routes>
        <Route
          path="/console/:orgSlug"
          element={
            <ConsoleLayout>
              <Overview />
            </ConsoleLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

let openSpy;
beforeEach(() => {
  resetConsoleOrgs();
  localStorage.clear();
  setCurrentUserId('u1');
  vi.clearAllMocks();
  orgService.getCodes.mockResolvedValue({ data: { codes: [] } });
  orgService.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
  orgService.getApplications.mockResolvedValue({ data: { items: [], nextCursor: null, pendingCount: 0 } });
  orgService.getOverview.mockResolvedValue(overview());
  orgService.getAttendanceDay.mockResolvedValue(attendanceDay());
  orgService.getPlans.mockResolvedValue({ data: { plans: [], payOnline: 'available' } });
  openSpy = vi.spyOn(window, 'open');
});

afterEach(() => {
  openSpy.mockRestore();
  cleanup();
  localStorage.clear();
  setCurrentUserId(null);
});

describe("the plan card's way to Paddle's page", () => {
  it('opens Paddle in a new tab for this gym, cut off from the console', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: plan() }));
    orgService.openBillingPortal.mockResolvedValue({ data: { url: `${PORTAL}?action=overview` } });
    const tab = fakeTab();
    openSpy.mockReturnValue(tab);
    renderOverview();

    expect(await screen.findByText(/^Renews /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage payment' }));
    // The tab opens on the press itself, before the link is asked for.
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(`${PORTAL}?action=overview`));
    expect(orgService.openBillingPortal).toHaveBeenCalledWith(GYM_ID);
    expect(tab.opener).toBeNull();
  });

  it('says when a cancelled plan ends, and still offers the page', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: plan({ cancelAtPeriodEnd: true }) }));
    renderOverview();
    expect(await screen.findByText(/^Ends /)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage payment' })).toBeTruthy();
  });

  it('closes the tab and says so when the page cannot be opened', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: plan() }));
    orgService.openBillingPortal.mockRejectedValue(Object.assign(new Error('503'), { response: { status: 503, data: { error: 'payments_unavailable', message: "Paying online isn't available right now. Please try again later." } } }));
    const tab = fakeTab();
    openSpy.mockReturnValue(tab);
    renderOverview();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage payment' }));
    expect(await screen.findByText(/isn't available right now/i)).toBeTruthy();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it('is not drawn for a free trial, nor for staff who cannot manage billing', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: plan({ status: 'trialing', trialEndsAt: '2026-12-01T00:00:00.000Z', priceLabel: null, currentPeriodEnd: null }) }));
    const { unmount } = renderOverview();
    expect(await screen.findByText('Free trial')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /manage payment|update your card/i })).toBeNull();
    unmount();
    resetConsoleOrgs();

    orgService.getMine.mockResolvedValue(mineIs({ ...TRAINER, subscription: plan() }));
    renderOverview();
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalled());
    await screen.findByText('Iron House');
    expect(screen.queryByRole('button', { name: /manage payment|update your card/i })).toBeNull();
  });
});

describe('a failed payment', () => {
  it('in the 5 days of grace: the banner says so and the card asks for a new card', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: plan({ status: 'past_due' }) }));
    renderOverview();
    expect(await screen.findByText(/a payment for your gym didn't go through\. update your card under plan on the overview — your members keep everything for 5 days after a failed payment\./i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update your card' })).toBeTruthy();
    // Nothing is locked yet.
    expect(screen.queryByTestId('plan-modal')).toBeNull();
  });

  it('after the grace: the prompt asks for the card, never a new plan, and closes once the payment reaches the gym', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      orgService.getMine.mockResolvedValueOnce(mineIs(overdue(OWNER)));
      orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: plan() }));
      orgService.openBillingPortal.mockResolvedValue({ data: { url: `${PORTAL}?action=update_subscription_payment_method` } });
      const tab = fakeTab();
      openSpy.mockReturnValue(tab);
      renderOverview();

      expect(await screen.findByRole('heading', { name: 'Update your card' })).toBeTruthy();
      expect(screen.getByText(/pays what's owed and opens everything again/i)).toBeTruthy();
      // No plans, no Subscribe: a second plan would charge the gym twice.
      expect(orgService.getPlans).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /subscribe|free trial/i })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Update your card' }));
      await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(`${PORTAL}?action=update_subscription_payment_method`));
      expect(await screen.findByText(/opens again by itself/i)).toBeTruthy();

      // Paddle takes the payment; the next read of the gym finds it on a plan again.
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(screen.queryByTestId('plan-modal')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('after the grace: the banner says why, to every member of staff, and a trainer is not stopped', async () => {
    orgService.getMine.mockResolvedValue(mineIs(overdue(TRAINER)));
    renderOverview();
    expect(await screen.findByText(/a payment for your gym is overdue\. nothing here can be changed and your members get the free app only until your card is updated\./i)).toBeTruthy();
    expect(screen.queryByTestId('plan-modal')).toBeNull();
  });
});
