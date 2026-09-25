// Choosing a plan from the plan card (ROADMAP Stage 3 items 1c-ii and 1c-iii): a gym in its
// free trial pays now and is charged when the trial ends; a paying gym moves to a bigger size
// after seeing what Paddle will charge, or to a smaller one its members fit in, from its next
// payment. The worst thing on screen: a size changed that
// nobody confirmed, or one confirm sent as two changes.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
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
      previewSizeChange: vi.fn(),
      changeSize: vi.fn(),
      keepSize: vi.fn(),
    },
  };
});

vi.mock('../../utils/paddleCheckout', () => ({ openPaddleCheckout: vi.fn(), closePaddleCheckout: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { openPaddleCheckout } = await import('../../utils/paddleCheckout');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const { setCurrentUserId } = await import('../../utils/storage');
const { trialEndDateLabel } = await import('./billingView');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Overview = (await import('./Overview')).default;

const GYM_ID = '11111111-1111-1111-1111-111111111111';
const TRIAL_END = new Date(Date.now() + 6 * 86_400_000).toISOString();

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
  seatsUsed: 190,
  ownerTrialUsed: true,
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
  consoleReadOnly: false,
  paymentOverdue: false,
};
const TRAINER = { ...OWNER, staffRole: 'trainer', privileges: ['members.read', 'codes.invite'] };

const freeTrial = { status: 'trialing', trialEndsAt: TRIAL_END, seatCap: 200, priceLabel: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, subscribed: false };
const paidTrial = { status: 'trialing', trialEndsAt: TRIAL_END, seatCap: 200, priceLabel: '$79', currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, subscribed: true };
const paying = { status: 'active', trialEndsAt: null, seatCap: 200, priceLabel: '$79', currentPeriodEnd: '2026-11-01T00:00:00.000Z', cancelAtPeriodEnd: false, subscribed: true };
const PLANS = [
  { code: 'org_b1_us_m', priceLabel: '$79', currency: 'USD', interval: 'month', seatCap: 200, fits: true },
  { code: 'org_b2_us_m', priceLabel: '$129', currency: 'USD', interval: 'month', seatCap: 500, fits: true },
  { code: 'org_b3_us_m', priceLabel: '$199', currency: 'USD', interval: 'month', seatCap: 1000, fits: true },
];
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
  orgService.getPlans.mockResolvedValue({ data: { plans: PLANS, payOnline: 'available' } });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setCurrentUserId(null);
});

describe('paying during the free trial', () => {
  it('opens Paddle for the plan chosen, and says the first payment waits for the trial’s end', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: freeTrial }));
    orgService.startCheckout.mockResolvedValue({
      data: { checkoutId: '22222222-2222-2222-2222-222222222222', provider: 'paddle', environment: 'sandbox', clientToken: 'test_x', transactionId: 'txn_01j7zbyqs3vah3aafp4jf62qaw' },
    });
    renderOverview();
    expect(await screen.findByText(/keep your free days: the plan and its first payment start when the trial ends/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a plan' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        new RegExp(`carries on at up to 200 members\\. Your card is saved now; the plan you choose and its first payment start when the trial ends on ${trialEndDateLabel(TRIAL_END)}`),
      ),
    ).toBeTruthy();
    const rows = await within(dialog).findAllByRole('button', { name: 'Subscribe' });
    expect(rows).toHaveLength(3);
    fireEvent.click(rows[1]);
    await waitFor(() => expect(orgService.startCheckout).toHaveBeenCalledTimes(1));
    expect(orgService.startCheckout.mock.calls[0].slice(0, 2)).toEqual([GYM_ID, 'org_b2_us_m']);
    expect(openPaddleCheckout).toHaveBeenCalledTimes(1);
  });

  it('says nothing was charged when the server cancelled a trial saved too late', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: freeTrial }));
    orgService.startCheckout.mockResolvedValue({
      data: { checkoutId: '22222222-2222-2222-2222-222222222222', provider: 'paddle', environment: 'sandbox', clientToken: 'test_x', transactionId: 'txn_01j7zbyqs3vah3aafp4jf62qaw' },
    });
    orgService.syncCheckout.mockResolvedValue({ data: { state: 'trial_ended' } });
    openPaddleCheckout.mockImplementation(async ({ onEvent }) => {
      onEvent({ type: 'completed' });
    });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a plan' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click((await within(dialog).findAllByRole('button', { name: 'Subscribe' }))[0]);
    expect(await within(dialog).findByText(/This plan didn’t start and nothing was charged/)).toBeTruthy();
    expect(orgService.syncCheckout).toHaveBeenCalledTimes(1);
  });

  it('shows a paid trial’s first payment on the card, and offers a bigger size instead', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: paidTrial }));
    renderOverview();
    const card = (await screen.findAllByText(`Your first payment of $79 is on ${trialEndDateLabel(TRIAL_END)}.`))[0];
    expect(card).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose a plan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose a bigger size' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage payment' })).toBeTruthy();
  });

  it('keeps the trial’s 200 on the card and says when the chosen size starts', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: { ...paidTrial, priceLabel: '$129', nextSeatCap: 500 } }));
    renderOverview();
    expect(await screen.findByText(`Up to 500 members from ${trialEndDateLabel(TRIAL_END)}, when your first payment is taken.`)).toBeTruthy();
    expect(screen.getAllByText(/190 of 200 places used/).length).toBeGreaterThan(0);
  });

  it('a bigger size during the trial says it starts with the first payment, not now', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: paidTrial }));
    orgService.previewSizeChange.mockResolvedValue({ data: { planCode: 'org_b2_us_m', seatCap: 500, priceLabel: '$129', dueNow: null, nextPaymentAt: TRIAL_END } });
    orgService.changeSize.mockResolvedValue({ data: { subscription: { ...paidTrial, priceLabel: '$129', nextSeatCap: 500 } } });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a bigger size' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/The new size starts with your first payment on .*\. Until then your trial allows up to 200 members\./)).toBeTruthy();
    fireEvent.click((await within(dialog).findAllByRole('button', { name: 'Choose' }))[0]);
    await within(dialog).findByText(/Nothing to pay now/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(dialog).findByText(`Done. Up to 500 members from ${trialEndDateLabel(TRIAL_END)}, when your first payment is taken.`),
    ).toBeTruthy();
  });
});

describe('a bigger size', () => {
  it('lists only bigger sizes, shows Paddle’s price, and changes nothing until Confirm — then once', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: paying }));
    orgService.previewSizeChange.mockResolvedValue({
      data: { planCode: 'org_b2_us_m', seatCap: 500, priceLabel: '$129', dueNow: { totalLabel: '$53.52', subtotalLabel: '$49.15', taxLabel: '$4.37' }, nextPaymentAt: '2026-11-01T00:00:00.000Z' },
    });
    let answer;
    orgService.changeSize.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a bigger size' }));
    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByTestId('bigger-list');
    expect(within(list).queryByText('Up to 200 members')).toBeNull();
    expect(within(list).getByText('Up to 500 members')).toBeTruthy();
    expect(within(list).getByText('Up to 1000 members')).toBeTruthy();

    fireEvent.click(within(list).getAllByRole('button', { name: 'Choose' })[0]);
    expect(await within(dialog).findByText(/You pay \$53\.52 now \(\$49\.15 plus \$4\.37 tax\) for the rest of this month, then \$129 a month from/)).toBeTruthy();
    expect(orgService.previewSizeChange).toHaveBeenCalledWith(GYM_ID, 'org_b2_us_m');
    expect(orgService.changeSize).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(orgService.changeSize).toHaveBeenCalledTimes(1));
    const [gym, code, key] = orgService.changeSize.mock.calls[0];
    expect([gym, code]).toEqual([GYM_ID, 'org_b2_us_m']);
    expect(typeof key).toBe('string');
    answer({ data: { subscription: { ...paying, seatCap: 500, priceLabel: '$129' } } });
    expect(await within(dialog).findByText('Done. Up to 500 members can now join.')).toBeTruthy();
  });

  it('says the server’s words on a refusal, and a press after it is a new request that can succeed', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: paying }));
    orgService.previewSizeChange.mockResolvedValue({
      data: { planCode: 'org_b2_us_m', seatCap: 500, priceLabel: '$129', dueNow: null, nextPaymentAt: null },
    });
    const refusal = Object.assign(new Error('refused'), {
      response: { status: 503, data: { error: 'change_unconfirmed', message: "We couldn't confirm the change with Paddle. Reload the page in a minute to see your size before trying again." } },
    });
    orgService.changeSize.mockRejectedValueOnce(refusal).mockResolvedValueOnce({ data: { subscription: { ...paying, seatCap: 500 } } });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a bigger size' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click((await within(dialog).findAllByRole('button', { name: 'Choose' }))[0]);
    await within(dialog).findByText(/Nothing to pay now/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText(/We couldn't confirm the change with Paddle/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await within(dialog).findByText('Done. Up to 500 members can now join.');
    // The server answers a repeated key with its first answer, so the same key would stay refused.
    expect(orgService.changeSize.mock.calls[1][2]).not.toBe(orgService.changeSize.mock.calls[0][2]);
  });

  it('is offered to nobody who cannot pay, nor on a plan set to end', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...TRAINER, subscription: paying }, { ...OWNER, id: '33333333-3333-3333-3333-333333333333', slug: 'other' }));
    renderOverview();
    await screen.findByText('Iron House');
    expect(screen.queryByRole('button', { name: 'Choose a bigger size' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose a smaller size' })).toBeNull();
    cleanup();
    resetConsoleOrgs();
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: { ...paying, cancelAtPeriodEnd: true } }));
    renderOverview();
    await screen.findByRole('button', { name: 'Manage payment' });
    expect(screen.queryByRole('button', { name: 'Choose a bigger size' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose a smaller size' })).toBeNull();
  });
});

describe('a smaller size', () => {
  const on500 = { ...paying, seatCap: 500, priceLabel: '$129' };
  const NEXT = trialEndDateLabel('2026-11-01T00:00:00.000Z');
  const waiting = { ...on500, seatCap: 200, pendingSize: { seatCap: 200, priceLabel: '$79', from: '2026-11-01T00:00:00.000Z', currentSeatCap: 500 } };

  it('lists only smaller sizes, says nothing is charged and when the new price starts, and changes nothing until Confirm — then once', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: on500 }));
    orgService.previewSizeChange.mockResolvedValue({
      data: { planCode: 'org_b1_us_m', seatCap: 200, priceLabel: '$79', dueNow: null, nextPaymentAt: '2026-11-01T00:00:00.000Z' },
    });
    orgService.changeSize.mockResolvedValue({ data: { subscription: waiting } });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a smaller size' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(new RegExp(`start with your next payment on ${NEXT}; nothing is charged or given back now\\. From the moment you confirm, new members can join only up to the new size\\.`))).toBeTruthy();
    const list = await within(dialog).findByTestId('smaller-list');
    expect(within(list).getByText('Up to 200 members')).toBeTruthy();
    expect(within(list).queryByText('Up to 500 members')).toBeNull();
    expect(within(list).queryByText('Up to 1000 members')).toBeNull();

    fireEvent.click(within(list).getByRole('button', { name: 'Choose' }));
    expect(await within(dialog).findByText(`Nothing to pay now. $79 a month from ${NEXT}.`)).toBeTruthy();
    expect(orgService.changeSize).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(
      await within(dialog).findByText(`Done. Up to 200 members from ${NEXT}, at $79 a month. New members can join only up to 200 from now.`),
    ).toBeTruthy();
    expect(orgService.changeSize).toHaveBeenCalledTimes(1);
    expect(orgService.changeSize.mock.calls[0].slice(0, 2)).toEqual([GYM_ID, 'org_b1_us_m']);
  });

  it('will not choose a size smaller than the members the gym has, and says how many to remove', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 300, subscription: on500 }));
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a smaller size' }));
    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByTestId('smaller-list');
    expect(within(list).getByText('You have 300 members. Remove 100 to choose this size.')).toBeTruthy();
    const choose = within(list).getByRole('button', { name: 'Choose' });
    expect(choose.disabled).toBe(true);
    fireEvent.click(choose);
    expect(orgService.previewSizeChange).not.toHaveBeenCalled();
  });

  it('shows the size waiting on the card, and Keep undoes it once', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: waiting }));
    let answer;
    orgService.keepSize.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderOverview();
    expect(
      await screen.findByText(`From ${NEXT}: up to 200 members, $79 a month. New members can join only up to 200 from now.`),
    ).toBeTruthy();
    const keep = screen.getByRole('button', { name: 'Keep up to 500 members' });
    fireEvent.click(keep);
    fireEvent.click(keep);
    await waitFor(() => expect(orgService.keepSize).toHaveBeenCalledTimes(1));
    expect(orgService.keepSize).toHaveBeenCalledWith(GYM_ID);
    // The card is then re-read, and the server no longer has a size waiting.
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: on500 }));
    answer({ data: { subscription: on500 } });
    await waitFor(() => expect(screen.queryByTestId('pending-size')).toBeNull());
    expect(screen.queryByRole('button', { name: /Keep up to/ })).toBeNull();
  });

  it('while a smaller size waits, the smaller list leaves it out and the bigger list starts above the size paid for', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: { ...waiting, pendingSize: { ...waiting.pendingSize, currentSeatCap: 1000 } } }));
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a bigger size' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("You're on the biggest size there is.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose a smaller size' }));
    dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByTestId('smaller-list');
    expect(within(list).getByText('Up to 500 members')).toBeTruthy();
    expect(within(list).queryByText('Up to 200 members')).toBeNull();
  });
});
