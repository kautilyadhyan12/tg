// The plan card when a gym paying through Paddle is handed to a new owner, who chooses their own
// plan before the old one ends (ROADMAP Stage 2 item 4b-vi-a): the Overview, its plan box and the
// window to choose in, against a mocked api.
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
      getMyCoOwnerRequest: vi.fn(() => Promise.resolve({ data: { request: null } })),
      getMyOwnerRequest: vi.fn(() => Promise.resolve({ data: { request: null } })),
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
const { resetConsoleOrgs } = await import('./consoleOrgs');
const { setCurrentUserId } = await import('../../utils/storage');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Overview = (await import('./Overview')).default;

const GYM_ID = '11111111-1111-1111-1111-111111111111';

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

const plan = (patch = {}) => ({
  status: 'active',
  trialEndsAt: null,
  seatCap: 500,
  priceLabel: '$129',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  ...patch,
});
const mineIs = (...orgs) => ({ data: { orgs, formerOrgs: [] } });

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
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setCurrentUserId(null);
});

const { openPaddleCheckout } = await import('../../utils/paddleCheckout');

const DAY = 24 * 60 * 60 * 1000;
// Days from now, never a fixed date, so the tests do not expire.
const ENDS = new Date(Date.now() + 12 * DAY).toISOString();
const date = new Date(ENDS).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Kd's Paddle plan, handed over with the gym and confirmed to end: the next plan can be chosen. */
const handedOver = (patch = {}) =>
  plan({
    paidThrough: 'paddle',
    subscribed: true,
    seatCap: 200,
    priceLabel: '$29',
    cancelAtPeriodEnd: true,
    currentPeriodEnd: ENDS,
    handedOverBy: 'Kd Owner',
    nextPlanUntil: new Date(Date.parse(ENDS) - 3 * 60 * 60 * 1000).toISOString(),
    ...patch,
  });
/** Cora's plan, chosen before Kd's ended: it starts then. */
const following = (patch = {}) =>
  plan({
    status: 'trialing',
    paidThrough: 'paddle',
    subscribed: true,
    seatCap: 200,
    planSeatCap: 500,
    nextSeatCap: 500,
    priceLabel: '$49',
    trialEndsAt: ENDS,
    currentPeriodEnd: ENDS,
    followsPaidBy: 'Kd Owner',
    ...patch,
  });

describe('a new owner chooses their plan before the handed-over plan ends (4b-vi-a)', () => {
  it('the new owner is offered it, chooses in Paddle\'s window, and is told it starts on that day with nothing charged until then', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: handedOver() }));
    orgService.getPlans.mockResolvedValue({
      data: {
        plans: [
          { code: 'org_b1_us_m', seatCap: 200, priceMinor: 2900, currency: 'USD', priceLabel: '$29', fits: true },
          { code: 'org_b2_us_m', seatCap: 500, priceMinor: 4900, currency: 'USD', priceLabel: '$49', fits: true },
        ],
        payOnline: 'available',
      },
    });
    orgService.startCheckout.mockResolvedValue({
      data: { checkoutId: '22222222-2222-2222-2222-222222222222', provider: 'paddle', environment: 'sandbox', clientToken: 'test_x', transactionId: 'txn_01', email: 'cora@example.com', country: 'US' },
    });
    orgService.syncCheckout.mockResolvedValue({ data: { state: 'paid', subscription: following() } });
    let onEvent = null;
    openPaddleCheckout.mockImplementation((opts) => {
      onEvent = opts.onEvent;
      return Promise.resolve();
    });
    renderOverview();

    expect((await screen.findByTestId('plan-handed-over')).textContent).toBe(
      `Kd Owner paid for this plan, and it stops on ${date}. Choose your plan now and it starts then, so your members keep the app.`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose your plan' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Choose your plan');
    expect(
      within(dialog).getByText(
        `Your plan starts on ${date}, when the plan Kd Owner paid for ends, so your members keep the app. Nothing is charged until then. Paddle's window shows the days until then as a free trial, rounded up to whole days.`,
      ),
    ).toBeTruthy();
    const choices = await within(dialog).findAllByRole('button', { name: /Choose this plan/ });
    expect(choices).toHaveLength(2);
    fireEvent.click(choices[1]);
    await waitFor(() => expect(orgService.startCheckout).toHaveBeenCalledWith(GYM_ID, 'org_b2_us_m', expect.any(String)));
    await waitFor(() => expect(onEvent).not.toBeNull());
    act(() => onEvent({ type: 'completed', transactionId: 'txn_01' }));
    expect((await within(dialog).findByTestId('plan-choice-done')).textContent).toBe(`Done. Your plan starts on ${date}. Nothing is charged until then.`);
  });

  it("handed on before it started: the next owner's window names who paid for the days until then, not who chose it", async () => {
    // Cora chose a plan before Kd's ended, then handed the gym on to this owner.
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: following({ handedOverBy: 'Cora Lim', cancelAtPeriodEnd: true, nextPlanUntil: new Date(Date.parse(ENDS) - 3 * 60 * 60 * 1000).toISOString() }) }));
    orgService.getPlans.mockResolvedValue({
      data: { plans: [{ code: 'org_b1_us_m', seatCap: 200, priceMinor: 2900, currency: 'USD', priceLabel: '$29', fits: true }], payOnline: 'available' },
    });
    renderOverview();
    expect((await screen.findByTestId('plan-handed-over')).textContent).toBe(
      `Cora Lim chose this plan, and it stops on ${date}, before its first payment. Choose your plan now and it starts then, so your members keep the app.`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose your plan' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        `Your plan starts on ${date}, when the plan Kd Owner paid for ends, so your members keep the app. Nothing is charged until then. Paddle's window shows the days until then as a free trial, rounded up to whole days.`,
      ),
    ).toBeTruthy();
  });

  it('the old owner, who paid for it, is not offered the next plan', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, coOwner: true, subscription: handedOver({ handedOverByYou: true }) }));
    renderOverview();
    expect((await screen.findByTestId('plan-handed-over')).textContent).toBe(`You paid for this plan, and it stops on ${date}. You won't be charged again.`);
    expect(screen.queryByRole('button', { name: 'Choose your plan' })).toBeNull();
  });

  it('too close to the end, it is not offered, and the box says the plan is chosen once it ends', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: handedOver({ nextPlanUntil: new Date(Date.now() - 60_000).toISOString() }) }));
    renderOverview();
    expect((await screen.findByTestId('plan-handed-over')).textContent).toBe(
      `Kd Owner paid for this plan, and it stops on ${date}. Then choose your own plan and pay with your own card.`,
    );
    expect(screen.queryByRole('button', { name: 'Choose your plan' })).toBeNull();
  });

  it('the plan chosen says when it starts and who paid until then, never a free trial, and is cancelled after a box that names what stays', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: following() }));
    renderOverview();
    expect((await screen.findByTestId('plan-following')).textContent).toBe(`Starts on ${date}, when the plan Kd Owner paid for ends. Nothing is charged until then.`);
    expect(screen.getByText('Up to 500 members · $49 a month')).toBeTruthy();
    expect(screen.queryByText(/free trial/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change size' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel new plan' }));
    const box = await screen.findByTestId('cancel-new-plan-box');
    expect([...box.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      "It won't start, and nothing is charged.",
      `Your 12 members keep everything until ${date}, when the plan Kd Owner paid for ends. Then they get the free app only.`,
      expect.stringMatching(/^You can change your mind until .+\.$/),
    ]);
    const cancelled = following({ cancelAtPeriodEnd: true, keepUntil: new Date(Date.parse(ENDS) - 3 * 60 * 60 * 1000).toISOString() });
    orgService.cancelPlan.mockResolvedValue({ data: { subscription: cancelled } });
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: cancelled }));
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel new plan' }));
    await waitFor(() => expect(orgService.cancelPlan).toHaveBeenCalledWith(GYM_ID));
    await waitFor(() =>
      expect(screen.getByTestId('plan-following').textContent).toMatch(
        /^This plan was cancelled before it started, so nothing is charged\. To keep it, press Keep my plan before .+\.$/,
      ),
    );
    expect(screen.getByRole('button', { name: 'Keep my plan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel new plan' })).toBeNull();
  });

  it('the old owner reads the plan that follows theirs in their own words', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, coOwner: true, subscription: following({ followsPaidBy: 'Kd Owner', followsPaidByYou: true }) }));
    renderOverview();
    expect((await screen.findByTestId('plan-following')).textContent).toBe(`Starts on ${date}, when the plan you paid for ends. Nothing is charged until then.`);
  });

  it('a window the gym changed under before it was paid says nothing was charged', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: handedOver() }));
    orgService.getPlans.mockResolvedValue({
      data: { plans: [{ code: 'org_b1_us_m', seatCap: 200, priceMinor: 2900, currency: 'USD', priceLabel: '$29', fits: true }], payOnline: 'available' },
    });
    orgService.startCheckout.mockResolvedValue({
      data: { checkoutId: '22222222-2222-2222-2222-222222222222', provider: 'paddle', environment: 'sandbox', clientToken: 'test_x', transactionId: 'txn_01', email: 'cora@example.com', country: 'US' },
    });
    orgService.syncCheckout.mockResolvedValue({ data: { state: 'not_started' } });
    let onEvent = null;
    openPaddleCheckout.mockImplementation((opts) => {
      onEvent = opts.onEvent;
      return Promise.resolve();
    });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose your plan' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /Choose this plan/ }));
    await waitFor(() => expect(onEvent).not.toBeNull());
    act(() => onEvent({ type: 'completed', transactionId: 'txn_01' }));
    expect(
      await within(dialog).findByText('Your new plan didn’t start, and nothing was charged. Reload the page to see your plan, then choose again if you need to.'),
    ).toBeTruthy();
  });
});
