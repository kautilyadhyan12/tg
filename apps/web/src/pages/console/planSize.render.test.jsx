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

  it('shows a paid trial’s first payment on the card, and offers Change size instead', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: paidTrial }));
    renderOverview();
    const card = (await screen.findAllByText(`Your first payment of $79 is on ${trialEndDateLabel(TRIAL_END)}.`))[0];
    expect(card).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose a plan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change size' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage payment' })).toBeTruthy();
  });

  it('keeps the trial’s 200 on the card and says when the chosen size starts', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: { ...paidTrial, priceLabel: '$129', nextSeatCap: 500 } }));
    renderOverview();
    expect(await screen.findByText(`Up to 500 members from ${trialEndDateLabel(TRIAL_END)}, when your first payment is taken.`)).toBeTruthy();
    expect(screen.getAllByText(/190 of 200 members/).length).toBeGreaterThan(0);
  });

  it('a bigger size during the trial says it starts with the first payment, not now', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: paidTrial }));
    orgService.previewSizeChange.mockResolvedValue({ data: { planCode: 'org_b2_us_m', seatCap: 500, priceLabel: '$129', dueNow: null, nextPaymentAt: TRIAL_END } });
    orgService.changeSize.mockResolvedValue({ data: { subscription: { ...paidTrial, priceLabel: '$129', nextSeatCap: 500 } } });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Change size' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Your trial allows up to 200 members until your first payment on .*; the size you choose starts then\. Nothing is charged now\./)).toBeTruthy();
    const list = await within(dialog).findByTestId('size-list');
    expect(within(list).getAllByText('From your first payment')).toHaveLength(2);
    fireEvent.click(within(list).getAllByRole('button', { name: 'Choose' })[0]);
    await within(dialog).findByText(/Nothing to pay now/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(dialog).findByText(`Done. Up to 500 members from ${trialEndDateLabel(TRIAL_END)}, when your first payment is taken.`),
    ).toBeTruthy();
  });
});

describe('Change size', () => {
  const NEXT = trialEndDateLabel('2026-11-01T00:00:00.000Z');
  const on1000 = { ...paying, seatCap: 1000, priceLabel: '$199' };
  const waiting = { ...on1000, pendingSize: { seatCap: 500, priceLabel: '$129', from: '2026-11-01T00:00:00.000Z', decideAt: '2026-10-31T21:00:00.000Z', ifTooMany: null } };
  const rowOf = (list, text) => within(list).getByText(text).closest('li');

  it('heads the card with the size and price, lists every size with the gym’s own marked, and a bigger one changes once on Confirm', async () => {
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
    expect(await screen.findByText('Up to 200 members · $79 a month')).toBeTruthy();
    expect(screen.getByText(`Next payment $79 on ${NEXT}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Choose a (bigger|smaller) size/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change size' }));
    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByTestId('size-list');
    const own = rowOf(list, 'Up to 200 members');
    expect(own.getAttribute('data-kind')).toBe('current');
    expect(within(own).getByText('Your size')).toBeTruthy();
    expect(within(own).queryByRole('button')).toBeNull();
    const bigger = rowOf(list, 'Up to 500 members');
    expect(within(bigger).getByText('Pay the difference now')).toBeTruthy();

    fireEvent.click(within(bigger).getByRole('button', { name: 'Choose' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Change size' }));
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
    expect(screen.queryByRole('button', { name: 'Change size' })).toBeNull();
    cleanup();
    resetConsoleOrgs();
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: { ...paying, cancelAtPeriodEnd: true } }));
    renderOverview();
    await screen.findByRole('button', { name: 'Manage payment' });
    expect(screen.queryByRole('button', { name: 'Change size' })).toBeNull();
    expect(screen.getByText(`Ends ${NEXT}`)).toBeTruthy();
  });

  it('a smaller size starts with the next payment, nothing charged, and the gym keeps its whole size until then', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, subscription: on1000 }));
    orgService.previewSizeChange.mockResolvedValue({
      data: { planCode: 'org_b2_us_m', seatCap: 500, priceLabel: '$129', dueNow: null, nextPaymentAt: '2026-11-01T00:00:00.000Z' },
    });
    orgService.changeSize.mockResolvedValue({ data: { subscription: waiting } });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Change size' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(new RegExp(`A smaller one starts with your next payment on ${NEXT}; until then you keep your whole size\\.$`))).toBeTruthy();
    const list = await within(dialog).findByTestId('size-list');
    const smaller = rowOf(list, 'Up to 500 members');
    expect(within(smaller).getByText(`From ${NEXT}`)).toBeTruthy();
    // 190 members fit 500: no warning.
    expect(within(list).queryByText(/Remove/)).toBeNull();
    fireEvent.click(within(smaller).getByRole('button', { name: 'Choose' }));
    expect(await within(dialog).findByText(`Nothing to pay now. $129 a month from ${NEXT}.`)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(
      await within(dialog).findByText(`Done. You'll move to 500 members ($129 a month) on ${NEXT}. Until then you keep all ${(1000).toLocaleString()}.`),
    ).toBeTruthy();
    expect(orgService.changeSize).toHaveBeenCalledTimes(1);
    expect(orgService.changeSize.mock.calls[0].slice(0, 2)).toEqual([GYM_ID, 'org_b2_us_m']);
  });

  it('a smaller size the members do not fit may be chosen, and says how many to remove and by when, before and after Confirm', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 620, subscription: on1000 }));
    orgService.previewSizeChange.mockResolvedValue({
      data: { planCode: 'org_b2_us_m', seatCap: 500, priceLabel: '$129', dueNow: null, nextPaymentAt: '2026-11-01T00:00:00.000Z' },
    });
    orgService.changeSize.mockResolvedValue({ data: { subscription: waiting } });
    renderOverview();
    fireEvent.click(await screen.findByRole('button', { name: 'Change size' }));
    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByTestId('size-list');
    const smaller = rowOf(list, 'Up to 500 members');
    const warning = new RegExp(`^You have 620 members\\. Remove 120 by .+ to move to 500\\. Otherwise you'll stay on ${(1000).toLocaleString()} members at \\$199 a month\\.$`);
    expect(within(smaller).getByText(warning)).toBeTruthy();
    fireEvent.click(within(smaller).getByRole('button', { name: 'Choose' }));
    await within(dialog).findByText(`Nothing to pay now. $129 a month from ${NEXT}.`);
    expect(within(dialog).getByText(warning)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await within(dialog).findByText(/^Done\. You'll move to 500 members/);
    expect(within(dialog).getByText(warning)).toBeTruthy();
  });

  it('the card says what is waiting, how many to remove, links to the members, and Cancel this change undoes it once', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 620, subscription: waiting }));
    let answer;
    orgService.keepSize.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderOverview();
    expect(await screen.findByText(`Changing to 500 members ($129 a month) on ${NEXT}`)).toBeTruthy();
    expect(screen.queryByText(/Next payment/)).toBeNull();
    const fit = screen.getByTestId('pending-fit');
    expect(fit.textContent).toMatch(/^You have 620 members\. Remove 120 by .+ to move to 500\. Otherwise you'll stay on .+ members at \$199 a month\. Go to members$/);
    expect(within(fit).getByRole('link', { name: 'Go to members' }).getAttribute('href')).toBe('/console/iron-house/members');
    expect(screen.getAllByText(`620 of ${(1000).toLocaleString()} members.`).length).toBeGreaterThan(0);

    const cancel = screen.getByRole('button', { name: 'Cancel this change' });
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    await waitFor(() => expect(orgService.keepSize).toHaveBeenCalledTimes(1));
    expect(orgService.keepSize).toHaveBeenCalledWith(GYM_ID);
    // The card is then re-read, and the server no longer has a size waiting.
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 620, subscription: on1000 }));
    answer({ data: { subscription: on1000 } });
    await waitFor(() => expect(screen.queryByTestId('pending-size')).toBeNull());
    expect(await screen.findByText(`Next payment $199 on ${NEXT}`)).toBeTruthy();
  });

  it('says the gym is ready when its members fit, and says so when a smaller size was not made', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 190, subscription: waiting }));
    renderOverview();
    expect(await screen.findByText(`You're ready: you'll move to 500 members on ${NEXT}.`)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Go to members' })).toBeNull();
    cleanup();
    resetConsoleOrgs();
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 620, subscription: { ...on1000, sizeKept: { seatCap: 500, members: 620 } } }));
    renderOverview();
    expect(
      await screen.findByText(
        `Your size stayed at ${(1000).toLocaleString()} members: you had 620 when it was due to change, more than 500, so you pay $199 a month. Change size again whenever you're ready.`,
      ),
    ).toBeTruthy();
  });
});

describe('the last days’ question', () => {
  const on1000 = { ...paying, seatCap: 1000, priceLabel: '$199', currentPeriodEnd: new Date(Date.now() + 2 * 86_400_000).toISOString() };
  const soon = (ifTooMany, seatCap = 200, priceLabel = '$79') => ({
    ...on1000,
    pendingSize: {
      seatCap,
      priceLabel,
      from: on1000.currentPeriodEnd,
      decideAt: new Date(Date.now() + 2 * 86_400_000 - 3 * 3_600_000).toISOString(),
      ifTooMany,
    },
  });
  const FALLBACK = { planCode: 'org_b2_us_m', seatCap: 500, priceLabel: '$129' };
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('asks billing staff with too many members to choose, and Move instead chooses the size that fits, once', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 250, subscription: soon(FALLBACK) }));
    let answer;
    orgService.changeSize.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderOverview();
    const prompt = await screen.findByTestId('size-decision');
    expect(within(prompt).getByText(/^You asked to move to 200 members on .+, but you have 250\. What would you like to do\?$/)).toBeTruthy();
    expect(within(prompt).getByRole('button', { name: 'Remove 50 members' })).toBeTruthy();
    expect(within(prompt).getByRole('button', { name: `Stay on ${(1000).toLocaleString()} ($199 a month)` })).toBeTruthy();
    expect(within(prompt).getByText(/^If you don't choose, on .+ you'll move to 500 members \(\$129 a month\)\.$/)).toBeTruthy();
    const move = within(prompt).getByRole('button', { name: 'Move to 500 instead ($129 a month)' });
    fireEvent.click(move);
    fireEvent.click(move);
    await waitFor(() => expect(orgService.changeSize).toHaveBeenCalledTimes(1));
    expect(orgService.changeSize.mock.calls[0].slice(0, 2)).toEqual([GYM_ID, 'org_b2_us_m']);
    // The server now has 500 waiting, which the 250 fit: nothing more to ask.
    const now500 = soon(null, 500, '$129');
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 250, subscription: now500 }));
    answer({ data: { subscription: now500 } });
    await waitFor(() => expect(screen.queryByTestId('size-decision')).toBeNull());
  });

  it('Remove members goes to the members page', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 250, subscription: soon(FALLBACK) }));
    render(
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
          <Route path="/console/:orgSlug/members" element={<div>the members page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const prompt = await screen.findByTestId('size-decision');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Remove 50 members' }));
    expect(await screen.findByText('the members page')).toBeTruthy();
    expect(orgService.changeSize).not.toHaveBeenCalled();
    expect(orgService.keepSize).not.toHaveBeenCalled();
  });

  it('Stay cancels the change; closing it answers nothing, and it stays closed for this visit', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 250, subscription: soon(null) }));
    orgService.keepSize.mockResolvedValue({ data: { subscription: on1000 } });
    renderOverview();
    let prompt = await screen.findByTestId('size-decision');
    expect(within(prompt).queryByRole('button', { name: /instead/ })).toBeNull();
    expect(within(prompt).getByText(`If you don't choose, you'll stay on ${(1000).toLocaleString()} members.`)).toBeTruthy();
    fireEvent.click(within(prompt).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('size-decision')).toBeNull();
    expect(orgService.keepSize).not.toHaveBeenCalled();
    expect(orgService.changeSize).not.toHaveBeenCalled();
    cleanup();
    resetConsoleOrgs();
    renderOverview();
    await screen.findByText(/^Changing to 200 members/);
    expect(screen.queryByTestId('size-decision')).toBeNull();

    // A new visit asks again; Stay cancels the change.
    cleanup();
    resetConsoleOrgs();
    window.sessionStorage.clear();
    renderOverview();
    prompt = await screen.findByTestId('size-decision');
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 250, subscription: on1000 }));
    fireEvent.click(within(prompt).getByRole('button', { name: `Stay on ${(1000).toLocaleString()} ($199 a month)` }));
    await waitFor(() => expect(orgService.keepSize).toHaveBeenCalledWith(GYM_ID));
    await waitFor(() => expect(screen.queryByTestId('size-decision')).toBeNull());
  });

  it('asks nobody when the members fit, when it is more than 3 days away, or a trainer', async () => {
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 150, subscription: soon(FALLBACK) }));
    renderOverview();
    await screen.findByText(/^Changing to 200 members/);
    expect(screen.queryByTestId('size-decision')).toBeNull();
    cleanup();
    resetConsoleOrgs();
    const far = soon(FALLBACK);
    far.pendingSize = { ...far.pendingSize, decideAt: new Date(Date.now() + 5 * 86_400_000).toISOString() };
    orgService.getMine.mockResolvedValue(mineIs({ ...OWNER, seatsUsed: 250, subscription: far }));
    renderOverview();
    await screen.findByText(/^Changing to 200 members/);
    expect(screen.queryByTestId('size-decision')).toBeNull();
    cleanup();
    resetConsoleOrgs();
    orgService.getMine.mockResolvedValue(mineIs({ ...TRAINER, seatsUsed: 250, subscription: soon(FALLBACK) }));
    renderOverview();
    await screen.findByText('Iron House');
    expect(screen.queryByTestId('size-decision')).toBeNull();
  });
});
