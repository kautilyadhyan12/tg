// Managing a gym's paid plan on screen (ROADMAP Stage 3 items 1c-i and 1d-ii): the plan card's
// button to Paddle's own page, Razorpay's Pay now, Update payment method and Cancel plan, the
// failed-payment banner, and the prompt that asks for the payment once the 2-day grace has run
// out — never a second plan.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
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
      getStartHere: vi.fn(),
      getAttendanceDay: vi.fn(),
      getPlans: vi.fn(),
      startCheckout: vi.fn(),
      syncCheckout: vi.fn(),
      startTrial: vi.fn(),
      openBillingPortal: vi.fn(),
      razorpayPayLink: vi.fn(),
      razorpayMethod: vi.fn(),
      razorpayRefresh: vi.fn(),
      cancelPlan: vi.fn(),
      keepPlan: vi.fn(),
    },
  };
});

vi.mock('../../utils/paddleCheckout', () => ({ openPaddleCheckout: vi.fn(), closePaddleCheckout: vi.fn() }));
vi.mock('../../utils/razorpayCheckout', () => ({ openRazorpayCheckout: vi.fn(), closeRazorpayCheckout: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { openRazorpayCheckout } = await import('../../utils/razorpayCheckout');
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

    expect(await screen.findByText(/^Next payment /)).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: /manage payment|update payment method/i })).toBeNull();
    unmount();
    resetConsoleOrgs();

    orgService.getMine.mockResolvedValue(mineIs({ ...TRAINER, subscription: plan() }));
    renderOverview();
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalled());
    await screen.findByRole('heading', { name: 'Iron House' });
    expect(screen.queryByRole('button', { name: /manage payment|update payment method/i })).toBeNull();
  });
});

describe('a failed payment', () => {
  it('in the 2 days of grace: the banner says so and the card asks for a new card', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: plan({ status: 'past_due' }) }));
    renderOverview();
    expect(
      await screen.findByText(
        /a payment for your gym didn't go through\. paddle will try your card again by itself, or you can update your payment method under plan on the overview\. your members keep everything for 2 days after a failed payment\./i,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeTruthy();
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

      expect(await screen.findByRole('heading', { name: 'Update payment method' })).toBeTruthy();
      expect(screen.getByText(/pays what's owed and opens everything again\. paddle also tries your card again by itself/i)).toBeTruthy();
      // No plans, no Subscribe: a second plan would charge the gym twice.
      expect(orgService.getPlans).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /subscribe|free trial/i })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Update payment method' }));
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
    expect(
      await screen.findByText(
        /a payment for your gym is overdue\. nothing here can be changed and your members get the free app only until it is paid\. whoever manages billing can update the payment method; paddle also tries the card again by itself\./i,
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('plan-modal')).toBeNull();
  });
});

describe('a plan paid through Razorpay (an Indian gym, 1d-i and 1d-ii)', () => {
  const INDIA = { ...OWNER, country: 'IN', currencyDisplay: 'INR' };
  const rupees = (patch = {}) => plan({ priceLabel: '₹12,500', subscribed: true, paidThrough: 'razorpay', keepUntil: null, ...patch });
  const LINK = 'https://rzp.io/rzp/MUp0Qi83';

  it("says it is paid through Razorpay; its card, cancel and Change size are here, never Paddle's page", async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: rupees() }));
    renderOverview();
    expect((await screen.findByTestId('paid-through-razorpay')).textContent).toBe('Paid through Razorpay, which emails you about each payment.');
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel plan' })).toBeTruthy();
    // A bigger size is paid in Razorpay's window (1d-iii-a).
    expect(screen.getByRole('button', { name: 'Change size' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /manage payment|pay now|keep my plan/i })).toBeNull();
  });

  it('a trial paid through Razorpay, not yet charged, says its size changes after the first payment, and offers no Change size', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: rupees({ status: 'trialing', trialEndsAt: '2026-11-01T00:00:00.000Z' }) }));
    renderOverview();
    expect((await screen.findByTestId('paid-through-razorpay')).textContent).toBe(
      'Paid through Razorpay, which emails you about each payment. You can change your size once your first payment is taken.',
    );
    expect(screen.queryByRole('button', { name: 'Change size' })).toBeNull();
  });

  it('a trainer sees no button to pay, change or cancel', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, ...TRAINER, country: 'IN', subscription: rupees({ status: 'past_due' }) }));
    renderOverview();
    expect(await screen.findByText(/whoever manages billing can pay it now/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay now|update payment method|cancel plan/i })).toBeNull();
  });

  it('Cancel plan asks first, naming the date and the members, with Keep my plan beside it; nothing is sent until it is confirmed', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: rupees() }));
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel plan' }));
    const box = screen.getByTestId('cancel-box');
    expect(box.textContent).toMatch(/Cancel your plan\?/);
    expect(box.textContent).toMatch(/Your plan ends on .+, the end of the month you paid for\. Nothing more is charged\./);
    expect(box.textContent).toMatch(/Your 12 members keep everything until then\./);
    expect(orgService.cancelPlan).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId('cancel-box')).getByRole('button', { name: 'Keep my plan' }));
    expect(screen.queryByTestId('cancel-box')).toBeNull();

    const ending = rupees({ cancelAtPeriodEnd: true, keepUntil: '2026-10-31T21:00:00.000Z' });
    orgService.cancelPlan.mockResolvedValue({ data: { subscription: ending } });
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: ending }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));
    fireEvent.click(within(screen.getByTestId('cancel-box')).getByRole('button', { name: 'Cancel plan' }));
    await waitFor(() => expect(orgService.cancelPlan).toHaveBeenCalledWith(GYM_ID));
    expect(await screen.findByText(/^You cancelled this plan\. You can keep it until /)).toBeTruthy();
    expect(screen.getByText(/^Ends /)).toBeTruthy();

    orgService.keepPlan.mockResolvedValue({ data: { subscription: rupees() } });
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: rupees() }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my plan' }));
    await waitFor(() => expect(orgService.keepPlan).toHaveBeenCalledWith(GYM_ID));
    expect(await screen.findByRole('button', { name: 'Cancel plan' })).toBeTruthy();
  });

  it('a plan set to end too close to its end to keep says so, with no Keep my plan', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: rupees({ cancelAtPeriodEnd: true, keepUntil: null }) }));
    renderOverview();
    expect(await screen.findByText(/too close to its end to keep it now/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /keep my plan|cancel plan/i })).toBeNull();
  });

  it('a failed payment: Pay now opens the bill in a new tab, cut off from the console', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: rupees({ status: 'past_due' }) }));
    orgService.razorpayPayLink.mockResolvedValue({ data: { url: LINK } });
    orgService.razorpayRefresh.mockResolvedValue({ status: 204 });
    const tab = fakeTab();
    openSpy.mockReturnValue(tab);
    renderOverview();
    expect(
      await screen.findByText(
        "A payment for your gym didn't go through. Razorpay tries again by itself, or you can pay now under Plan on the Overview. Your members keep everything for 2 days after a failed payment.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pay now' }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(LINK));
    expect(orgService.razorpayPayLink).toHaveBeenCalledWith(GYM_ID);
    expect(tab.opener).toBeNull();
    expect(await screen.findByText(/Razorpay's page for the bill is open in a new tab/)).toBeTruthy();
    expect(orgService.openBillingPortal).not.toHaveBeenCalled();
  });

  it("Pay now with nothing owed closes the tab it opened and says why", async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: rupees({ status: 'past_due' }) }));
    orgService.razorpayPayLink.mockRejectedValue({
      response: { status: 409, data: { error: 'nothing_owed', message: 'Nothing is owed right now. A payment just made can take a minute to show here.' } },
    });
    const tab = fakeTab();
    openSpy.mockReturnValue(tab);
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Pay now' }));
    expect(await screen.findByText('Nothing is owed right now. A payment just made can take a minute to show here.')).toBeTruthy();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it("Update payment method opens Razorpay's window to change THIS plan's card, then says the bill still needs paying", async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...INDIA, subscription: rupees({ status: 'past_due' }) }));
    orgService.razorpayMethod.mockResolvedValue({
      data: { keyId: 'rzp_test_AAAAAAAAAAAAAA', subscriptionId: 'sub_ThvJtZQg9As2NX', contact: '+919876543210', email: 'owner@gmail.com' },
    });
    orgService.razorpayRefresh.mockResolvedValue({ status: 204 });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Update payment method' }));
    await waitFor(() => expect(openRazorpayCheckout).toHaveBeenCalled());
    const options = openRazorpayCheckout.mock.calls[0][0];
    expect(options).toMatchObject({ subscriptionId: 'sub_ThvJtZQg9As2NX', changeMethod: true, email: 'owner@gmail.com', contact: '+919876543210' });
    act(() => options.onEvent({ type: 'completed' }));
    expect(await screen.findByText("Your payment method is updated. It doesn't pay the bill that's owed: press Pay now to pay it.")).toBeTruthy();
  });

  it('after the grace: the prompt offers Pay now and Update payment method, and no Paddle page', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...overdue(INDIA), paymentOverdueThrough: 'razorpay' }));
    orgService.razorpayPayLink.mockResolvedValue({ data: { url: LINK } });
    orgService.razorpayRefresh.mockResolvedValue({ status: 204 });
    const tab = fakeTab();
    openSpy.mockReturnValue(tab);
    renderOverview();
    expect(await screen.findByRole('heading', { name: 'A payment is overdue' })).toBeTruthy();
    expect(screen.getByTestId('overdue-razorpay').textContent).toBe(
      "Pay the bill that's owed and everything opens again by itself. To have your next payments go through, update your payment method too.",
    );
    const modal = screen.getByTestId('plan-modal');
    expect(within(modal).getByRole('button', { name: 'Update payment method' })).toBeTruthy();
    expect(within(modal).queryByRole('button', { name: /cancel plan|manage payment|subscribe/i })).toBeNull();
    fireEvent.click(within(modal).getByRole('button', { name: 'Pay now' }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(LINK));
    expect(orgService.openBillingPortal).not.toHaveBeenCalled();
  });
});
