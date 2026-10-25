// THE PAYMENTS TO MATCH PAGE, drawn (ROADMAP 18d-iii-b-ii-a). Only the network is mocked: what staff see
// is read off the real page.
//
// The worst thing the screen could do: Match on one row sending another row's payment, or a bill nobody
// picked; a press with no box first; Not a bill payment without saying why; or a row's answer lost when
// the list is read again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const svc = { list: vi.fn(), summary: vi.fn(), bills: vi.fn(), match: vi.fn(), notABill: vi.fn(), undo: vi.fn() };
const register = { findPeople: vi.fn() };
const orgApi = { getMine: vi.fn(), getMemberList: vi.fn() };
vi.mock('../../api/paymentsToMatchApi', () => ({ paymentsToMatchService: svc }));
vi.mock('../../api/registerApi', () => ({ registerService: register }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, onClose }) => (
    <div role="dialog" aria-label={`person ${entryId}`}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));
// The gym's open line has its own tests (`liveNews.render.test.jsx`); here the test says what the server
// would tell the page.
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
        if (!active) return undefined;
        const listener = { gymId, fn: (message) => latest.current(message) };
        live.listeners.add(listener);
        return () => live.listeners.delete(listener);
      }, [gymId, active]);
    },
  };
});
const tell = (message) =>
  act(() => {
    for (const listener of live.listeners) listener.fn(message);
  });

const PaymentsToMatch = (await import('./PaymentsToMatch')).default;
const PaymentsToMatchCard = (await import('../../components/console/PaymentsToMatchCard')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'members.confirm', 'billing.members', 'org.manage'],
  timezone: 'America/Chicago',
  country: 'US',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};

const BEN = { entryId: '21111111-1111-4111-8111-111111111111', name: 'Ben Ortiz', memberNumber: '12', email: 'ben@gmail.com', past: false };
const AMY = { entryId: '22222222-1111-4111-8111-111111111111', name: 'Amy Lee', memberNumber: '7', email: 'amy@gmail.com', past: false };
const ROW_BEN = {
  id: '11111111-1111-4111-8111-111111111111',
  takenAt: '2026-10-22T15:14:00.000Z',
  amountMinor: 2706,
  tipMinor: 0,
  currency: 'USD',
  enteredMinor: 2500,
  refundedMinor: 0,
  card: { brand: 'VISA', last4: '4242' },
  source: null,
  customer: null,
  person: BEN,
  linkedNames: [],
  suggested: BEN,
  reason: 'square_tax',
  holdsCard: true,
};
const ROW_AMY = {
  ...ROW_BEN,
  id: '12222222-1111-4111-8111-111111111111',
  takenAt: '2026-10-21T20:02:00.000Z',
  amountMinor: 1500,
  enteredMinor: null,
  card: null,
  source: 'CASH',
  customer: { name: 'Amy Lee', email: 'amy@gmail.com', phone: '+1 312-555-0100' },
  person: null,
  suggested: null,
  reason: 'not_linked',
  holdsCard: false,
};
const answer = (over = {}) => ({ count: 2, totals: [{ currency: 'USD', minor: 4206 }], square: true, payments: [ROW_BEN, ROW_AMY], next: null, ...over });
const bill = (over = {}) => ({
  entryId: BEN.entryId,
  name: BEN.name,
  membershipId: '31111111-1111-4111-8111-111111111111',
  typeName: 'Gold Weekly',
  target: { kind: 'period', periodIndex: 1 },
  fee: null,
  covers: { from: '2026-10-19', to: '2026-10-25' },
  dueOn: '2026-10-25',
  leftMinor: 2500,
  currency: 'USD',
  cannot: null,
  ...over,
});
const KID_BILL = bill({ entryId: '23333333-1111-4111-8111-111111111111', name: 'Kai Ortiz', membershipId: '32222222-1111-4111-8111-111111111111' });
const benBills = { person: BEN, today: '2026-10-25', amountMinor: 2500, bills: [bill(), KID_BILL], suggested: 0, paid: [{ amountMinor: 2500, currency: 'USD', paidOn: '2026-10-18', method: 'cash', forName: null }] };

const open = (path = '/console/iron-house/payments-to-match', org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/console/:orgSlug/payments-to-match" element={<PaymentsToMatch />} />
        <Route path="/console/:orgSlug/settings" element={<p>The Settings page</p>} />
      </Routes>
    </MemoryRouter>,
  );
};
const rows = () => screen.getAllByTestId('payment-to-match-row');
const row = (text) => rows().find((r) => r.textContent.includes(text));

beforeEach(() => {
  resetConsoleOrgs();
  live.listeners.clear();
  svc.list.mockResolvedValue(answer());
  svc.summary.mockResolvedValue({ count: 1, totals: [{ currency: 'USD', minor: 1500 }] });
  svc.bills.mockResolvedValue(benBills);
  orgApi.getMemberList.mockResolvedValue({ data: { list: null } });
  register.findPeople.mockResolvedValue([AMY]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Payments to match', () => {
  it("each row says when, what with, who and why, and that the card on file waits; Match opens a box first, then puts that row's payment on the bill picked, once", async () => {
    open();
    await screen.findByText('2 payments to match · $42.06');
    const ben = row('Ben Ortiz');
    expect(ben.textContent).toContain('$27.06');
    const facts = within(ben).getByTestId('payment-to-match-facts').textContent;
    expect(facts).toContain('Visa ending 4242');
    expect(facts).toContain('Square added $2.06 of tax on top of the $25.00 entered.');
    expect(facts).toContain('Match puts the $25.00 entered on the bill.');
    expect(facts).toContain('Not charged for Ben Ortiz while this waits');
    // Square's own tax settings are one press away, for whoever may change them.
    expect(within(ben).getByRole('link', { name: "Square's tax settings" }).getAttribute('href')).toBe('/console/iron-house/settings#payments');
    const amy = row('Amy Lee (in Square)');
    expect(within(amy).getByTestId('payment-to-match-facts').textContent).toContain('Amy Lee · amy@gmail.com · +1 312-555-0100');
    expect(within(amy).getByTestId('payment-to-match-facts').textContent).toContain('Cash');

    fireEvent.click(within(ben).getByRole('button', { name: 'Match' }));
    expect(svc.match).not.toHaveBeenCalled();
    const box = within(within(ben).getByTestId('match-box'));
    // Who paid is filled in where the app can tell, and the bill of exactly that amount is ticked.
    expect(box.getByTestId('match-person').textContent).toContain('Ben Ortiz');
    await box.findByText('Which bill was it for?');
    expect(box.getByText('Kai Ortiz: Gold Weekly · 19 Oct – 25 Oct 2026')).toBeTruthy();
    expect(box.getByRole('radio', { name: /^Gold Weekly · 19 Oct – 25 Oct 2026\$25.00 left · Due today$/ }).checked).toBe(true);
    expect(box.getByText('$25.00 goes on the bill. Square added $2.06 on top.')).toBeTruthy();
    expect(within(box.getByTestId('match-paid')).getByText('$25.00 · Cash · 18 Oct')).toBeTruthy();
    expect(svc.bills).toHaveBeenCalledWith('g1', ROW_BEN.id, BEN.entryId);

    // The kid's bill picked instead: that one goes in the press.
    fireEvent.click(box.getByRole('radio', { name: /^Kai Ortiz/ }));
    svc.match.mockResolvedValue({ matched: { entryId: KID_BILL.entryId, name: 'Kai Ortiz', amountMinor: 2500, currency: 'USD', receiptNumber: 58 } });
    fireEvent.click(box.getByRole('button', { name: 'Match $25.00 to this bill' }));
    await within(ben).findByText("Matched: $25.00 on Kai Ortiz's bill. Receipt 58.");
    expect(svc.match).toHaveBeenCalledTimes(1);
    const [gymId, paymentId, body] = svc.match.mock.calls[0];
    expect([gymId, paymentId]).toEqual(['g1', ROW_BEN.id]);
    expect(body).toMatchObject({ entryId: KID_BILL.entryId, membershipId: KID_BILL.membershipId, target: { kind: 'period', periodIndex: 1 }, amountMinor: 2500 });
    expect(typeof body.requestKey).toBe('string');
    expect(within(ben).queryByRole('button', { name: 'Match' })).toBeNull();
    await screen.findByText('1 payment to match · $15.00');
  });

  it('with nobody linked: the search starts with Square\'s name, the bills of whoever is picked are offered, and where Square didn\'t say how much was for the bill, the amount is asked and checked', async () => {
    const amyBills = { person: AMY, today: '2026-10-25', amountMinor: null, bills: [bill({ entryId: AMY.entryId, name: AMY.name }), bill({ entryId: AMY.entryId, name: AMY.name, membershipId: '34444444-1111-4111-8111-111111111111', typeName: 'Yoga Pack', leftMinor: 1000, cannot: 'too_little' })], suggested: null, paid: [] };
    svc.bills.mockResolvedValue(amyBills);
    open();
    await screen.findByText('2 payments to match · $42.06');
    const amy = row('Amy Lee (in Square)');
    fireEvent.click(within(amy).getByRole('button', { name: 'Match' }));
    const box = within(within(amy).getByTestId('match-box'));
    expect(box.getByLabelText('Find them by name, email or member number').value).toBe('Amy Lee');
    fireEvent.click(await box.findByRole('button', { name: /^Amy Lee · No\. 7/ }));
    await box.findByText('Which bill was it for?');
    expect(svc.bills).toHaveBeenCalledWith('g1', ROW_AMY.id, AMY.entryId);
    // A bill with less left than the payment can't be picked, and says why.
    expect(box.getByRole('radio', { name: /^Yoga Pack/ }).disabled).toBe(true);
    expect(box.getByText('Only $10.00 is left on this bill, less than $15.00.')).toBeTruthy();
    // Nothing ticked by itself where no bill is exactly the amount: Match waits for a pick.
    expect(box.getByRole('button', { name: 'Match' }).disabled).toBe(true);
    fireEvent.click(box.getByRole('radio', { name: /^Gold Weekly/ }));
    const amount = box.getByLabelText('How much of the $15.00 is for this bill?');
    expect(amount.value).toBe('15.00');
    fireEvent.change(amount, { target: { value: '16' } });
    expect(box.getByText('That is more than this payment. It is $15.00.')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Match' }).disabled).toBe(true);
    fireEvent.change(amount, { target: { value: '12.50' } });
    svc.match.mockResolvedValue({ matched: { entryId: AMY.entryId, name: 'Amy Lee', amountMinor: 1250, currency: 'USD', receiptNumber: 59 } });
    fireEvent.click(box.getByRole('button', { name: 'Match $12.50 to this bill' }));
    await within(amy).findByText("Matched: $12.50 on Amy Lee's bill. Receipt 59.");
    expect(svc.match.mock.calls[0][2]).toMatchObject({ entryId: AMY.entryId, amountMinor: 1250 });
  });

  it('Not a bill payment asks why first, then says so in the row with Undo, which puts it back', async () => {
    open();
    await screen.findByText('2 payments to match · $42.06');
    const ben = row('Ben Ortiz');
    fireEvent.click(within(ben).getByRole('button', { name: 'Not a bill payment' }));
    const box = within(within(ben).getByTestId('not-a-bill-box'));
    expect(box.getByText("Ben Ortiz's card on file can then be charged for their bills again.")).toBeTruthy();
    // Nothing is sent until why is chosen.
    expect(box.getByRole('button', { name: 'Not a bill payment' }).disabled).toBe(true);
    fireEvent.click(box.getByRole('radio', { name: 'It’s already recorded on a bill by hand' }));
    svc.notABill.mockResolvedValue({ state: 'not_bill', why: 'by_hand' });
    fireEvent.click(box.getByRole('button', { name: 'Not a bill payment' }));
    await within(ben).findByText('Marked as already recorded on a bill by hand.');
    expect(svc.notABill).toHaveBeenCalledWith('g1', ROW_BEN.id, 'by_hand');
    svc.undo.mockResolvedValue({ state: 'waiting', why: null });
    fireEvent.click(within(ben).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(svc.undo).toHaveBeenCalledWith('g1', ROW_BEN.id));
    await waitFor(() => expect(within(row('Ben Ortiz')).getByRole('button', { name: 'Match' })).toBeTruthy());
  });

  it("what another person does is read again from the server's news, and a row done here keeps saying so in its place", async () => {
    open();
    await screen.findByText('2 payments to match · $42.06');
    fireEvent.click(within(row('Amy Lee (in Square)')).getByRole('button', { name: 'Not a bill payment' }));
    fireEvent.click(screen.getByRole('radio', { name: 'A shop sale, or something else' }));
    svc.notABill.mockResolvedValue({ state: 'not_bill', why: 'other' });
    fireEvent.click(within(screen.getByTestId('not-a-bill-box')).getByRole('button', { name: 'Not a bill payment' }));
    await screen.findByText('Marked as not a bill payment.');
    // Somebody else matched Ben's meanwhile: the list read again holds neither row.
    svc.list.mockResolvedValue(answer({ count: 0, totals: [], payments: [] }));
    await tell({ what: 'paymentsToMatch' });
    await waitFor(() => expect(screen.queryByText('Ben Ortiz')).toBeNull());
    expect(screen.getByText('Marked as not a bill payment.')).toBeTruthy();
    expect(svc.list).toHaveBeenCalledTimes(2);
  });

  it("Match it on a person's page opens that payment's box, in view", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    open(`/console/iron-house/payments-to-match?payment=${ROW_AMY.id}`);
    await screen.findByText('2 payments to match · $42.06');
    expect(within(row('Amy Lee (in Square)')).getByTestId('match-box')).toBeTruthy();
    expect(within(row('Ben Ortiz')).queryByTestId('match-box')).toBeNull();
    expect(scrolled).toHaveBeenCalled();
  });

  it('payments another gym here shares a Square location with are counted, with the button to choose another location, or who can', async () => {
    svc.list.mockResolvedValue(answer({ sharedLocation: 2 }));
    open();
    const shared = await screen.findByTestId('payments-to-match-shared-location');
    expect(shared.textContent).toContain('2 payments taken at your Square location aren’t listed here: another gym in this app uses the same location, and no customer was added to the sale, so they can’t be told apart.');
    expect(shared.textContent).toContain('To match them, give each gym its own location in Square, then in one of the two gyms disconnect Square and connect it again, choosing the new location.');
    expect(within(shared).getByRole('link', { name: 'Open Square settings' }).getAttribute('href')).toBe('/console/iron-house/settings#payments');
    cleanup();
    resetConsoleOrgs();
    open('/console/iron-house/payments-to-match', { ...ORG, staffRole: 'manager', privileges: ['members.read', 'members.confirm', 'billing.members'] });
    const told = await screen.findByTestId('payments-to-match-shared-location');
    expect(within(told).queryByRole('link')).toBeNull();
    expect(told.textContent).toContain('The owner can give each gym its own Square location.');
  });

  it('says when there are none, and to whoever lacks the ticks, which ticks', async () => {
    svc.list.mockResolvedValue(answer({ count: 0, totals: [], payments: [] }));
    open();
    expect(await screen.findByTestId('payments-to-match-none')).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    open('/console/iron-house/payments-to-match', { ...ORG, staffRole: 'trainer', privileges: ['members.read', 'billing.members'] });
    expect(await screen.findByText(/Payments to match needs "Record members' payments" and "Keep the member list and invite"/)).toBeTruthy();
    expect(svc.list).toHaveBeenCalledTimes(1);
  });

  it("Overview's line: how many and what they come to, with the button, and nothing where there are none", async () => {
    svc.summary.mockResolvedValue({ count: 2, totals: [{ currency: 'USD', minor: 4206 }] });
    render(
      <MemoryRouter initialEntries={['/console/iron-house']}>
        <Routes>
          <Route path="/console/:orgSlug" element={<PaymentsToMatchCard gymId="g1" orgSlug="iron-house" privileges={ORG.privileges} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('2 payments from Square Point of Sale to match.')).toBeTruthy();
    expect(screen.getByText('$42.06 in all')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Payments to match' }).getAttribute('href')).toBe('/console/iron-house/payments-to-match');
    cleanup();
    svc.summary.mockResolvedValue({ count: 0, totals: [] });
    render(
      <MemoryRouter initialEntries={['/console/iron-house']}>
        <Routes>
          <Route path="/console/:orgSlug" element={<PaymentsToMatchCard gymId="g1" orgSlug="iron-house" privileges={ORG.privileges} />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(svc.summary).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('payments-to-match-card')).toBeNull();
  });
});
