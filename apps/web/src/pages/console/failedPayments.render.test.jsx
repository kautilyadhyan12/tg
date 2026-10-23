// THE FAILED PAYMENTS PAGE, drawn (ROADMAP 18d-iii-ii-b). Only the network is mocked: what staff
// see is read off the real page.
//
// The worst thing the screen could do: Try again on one row sending another row's card, amount or
// bill; a press with no box first; or a Try again offered where the server would refuse it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const svc = { list: vi.fn(), summary: vi.fn() };
const orgApi = { getMine: vi.fn(), getMemberList: vi.fn(), chargeCardOnFile: vi.fn(), chargeFeeToCardOnFile: vi.fn() };
vi.mock('../../api/failedPaymentsApi', () => ({ failedPaymentsService: svc }));
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

const FailedPayments = (await import('./FailedPayments')).default;
const FailedPaymentsCard = (await import('../../components/console/FailedPaymentsCard')).default;
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
const FRONT_DESK = { ...ORG, staffRole: 'manager', privileges: ['members.read', 'members.confirm', 'billing.members'] };

const declined = (over = {}) => ({ brand: 'VISA', last4: '1000', on: '2026-10-23', reason: 'declined', next: null, stop: 'bank', notice: { state: 'emailed', on: '2026-10-23' }, ...over });
const GINA = {
  billId: '11111111-1111-4111-8111-111111111111',
  entryId: '21111111-1111-4111-8111-111111111111',
  name: 'Gina Declined',
  past: false,
  membershipId: '31111111-1111-4111-8111-111111111111',
  typeName: 'Gold Weekly',
  periodIndex: 1,
  covers: { from: '2026-10-23', to: '2026-10-29' },
  fee: null,
  leftMinor: 2500,
  currency: 'USD',
  declined: declined(),
  retry: { kind: 'charge', card: { brand: 'VISA', last4: '1000' }, payerName: null, expired: false, cardRef: 'ref-gina', amountMinor: 2500 },
};
const NINA = {
  ...GINA,
  billId: '12222222-1111-4111-8111-111111111111',
  entryId: '22222222-1111-4111-8111-111111111111',
  membershipId: '32222222-1111-4111-8111-111111111111',
  name: 'Nina Short',
  declined: declined({ last4: '2000', reason: 'insufficient_funds', next: '2026-10-26', stop: null }),
  retry: { kind: 'wait', from: '2026-10-24T19:15:00.000Z' },
};
const FAY = {
  ...GINA,
  billId: '13333333-1111-4111-8111-111111111111',
  entryId: '23333333-1111-4111-8111-111111111111',
  membershipId: '33333333-1111-4111-8111-111111111111',
  name: 'Fay Fee',
  periodIndex: null,
  covers: null,
  fee: { kind: 'late_cancel', forName: 'Spin', on: '2026-10-21', to: null },
  leftMinor: 1500,
  declined: declined({ last4: '3000' }),
  retry: { kind: 'charge', card: { brand: 'VISA', last4: '3000' }, payerName: 'Mo Fee', expired: false, cardRef: 'ref-fay', amountMinor: 1500 },
};
const EZRA = {
  ...GINA,
  billId: '14444444-1111-4111-8111-111111111111',
  entryId: '24444444-1111-4111-8111-111111111111',
  membershipId: '34444444-1111-4111-8111-111111111111',
  name: 'Ezra Expired',
  past: true,
  declined: declined({ last4: '4000', reason: 'expired', stop: 'new_card' }),
  retry: { kind: 'no', why: 'new_card' },
};
const answer = (over = {}) => ({
  count: 4,
  totals: [{ currency: 'USD', minor: 9000 }],
  square: true,
  payments: [GINA, NINA, FAY, EZRA],
  next: null,
  ...over,
});
const paid = (row, receipt = 33) => ({
  data: {
    charge: {
      id: '41111111-1111-4111-8111-111111111111',
      membershipId: row.membershipId,
      feeBillId: row.fee === null ? null : row.billId,
      amountMinor: row.retry.amountMinor,
      currency: 'USD',
      card: row.retry.card,
      step: 'done',
      outcome: 'paid',
      reason: null,
      receiptNumber: receipt,
    },
  },
});

const open = (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/failed-payments']}>
      <Routes>
        <Route path="/console/:orgSlug/failed-payments" element={<FailedPayments />} />
        <Route path="/console/:orgSlug/settings" element={<p>The Settings page</p>} />
      </Routes>
    </MemoryRouter>,
  );
};
const rows = () => screen.getAllByTestId('failed-payment-row');
const row = (name) => rows().find((r) => r.textContent.includes(name));

beforeEach(() => {
  resetConsoleOrgs();
  svc.list.mockResolvedValue(answer());
  svc.summary.mockResolvedValue({ count: 3, totals: [{ currency: 'USD', minor: 6500 }], square: true });
  orgApi.getMemberList.mockResolvedValue({ data: { list: null } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Failed payments', () => {
  it("Try again asks first in a box under its row, then charges that row's own card, amount and bill", async () => {
    open();
    await screen.findByText('4 failed payments · $90.00 owed');
    expect(orgApi.chargeCardOnFile).not.toHaveBeenCalled();
    const gina = row('Gina Declined');
    fireEvent.click(within(gina).getByRole('button', { name: 'Try again' }));
    // Nothing charged by the first press: the box says what the second will do.
    expect(orgApi.chargeCardOnFile).not.toHaveBeenCalled();
    const box = within(gina).getByTestId('failed-payment-box');
    expect(box.textContent).toContain("$25.00 is charged to Gina Declined's Visa ending 1000 as soon as you press Charge $25.00.");
    orgApi.chargeCardOnFile.mockResolvedValue(paid(GINA));
    fireEvent.click(within(box).getByRole('button', { name: 'Charge $25.00' }));
    await within(gina).findByText('Charged $25.00 to Visa ending 1000. Receipt 33.');
    expect(orgApi.chargeCardOnFile).toHaveBeenCalledTimes(1);
    const [gymId, entryId, membershipId, body] = orgApi.chargeCardOnFile.mock.calls[0];
    expect([gymId, entryId, membershipId]).toEqual(['g1', GINA.entryId, GINA.membershipId]);
    expect(body).toMatchObject({ periodIndex: 1, amountMinor: 2500, cardRef: 'ref-gina' });
    expect(typeof body.requestKey).toBe('string');
    // Paid: no Try again on that row any more, and the heading counted again.
    expect(within(gina).queryByRole('button', { name: 'Try again' })).toBeNull();
    await screen.findByText('3 failed payments · $65.00 owed');
    expect(orgApi.chargeFeeToCardOnFile).not.toHaveBeenCalled();
  });

  it("a fee's Try again charges the fee, on the payer's card, and says whose it is first", async () => {
    open();
    const fay = await waitFor(() => row('Fay Fee'));
    expect(fay.textContent).toContain('Late cancel fee · Spin on');
    fireEvent.click(within(fay).getByRole('button', { name: 'Try again' }));
    expect(within(fay).getByTestId('failed-payment-box').textContent).toContain("Mo Fee's Visa ending 3000");
    orgApi.chargeFeeToCardOnFile.mockResolvedValue(paid(FAY, 34));
    fireEvent.click(within(fay).getByRole('button', { name: 'Charge $15.00' }));
    await within(fay).findByText('Charged $15.00 to Visa ending 3000. Receipt 34.');
    expect(orgApi.chargeFeeToCardOnFile.mock.calls[0].slice(0, 4)).toEqual(['g1', FAY.entryId, FAY.membershipId, FAY.billId]);
    expect(orgApi.chargeFeeToCardOnFile.mock.calls[0][4]).toMatchObject({ amountMinor: 1500, cardRef: 'ref-fay' });
    expect(orgApi.chargeCardOnFile).not.toHaveBeenCalled();
  });

  it('no Try again where the server would refuse it: declined under a day ago, or declined for good; each says why', async () => {
    open();
    const nina = await waitFor(() => row('Nina Short'));
    expect(within(nina).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(nina.textContent).toContain('The payment will be retried automatically on 26 Oct.');
    expect(nina.textContent).toContain('It can be retried from 2:15 PM on 24 Oct.');
    const ezra = row('Ezra Expired');
    expect(within(ezra).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(ezra.textContent).toContain('The bank declined this card permanently.');
    expect(ezra.textContent).toContain('Past member');
    // Every row opens the person's page, where every other way to pay is.
    fireEvent.click(within(ezra).getByRole('button', { name: 'Open their page' }));
    expect(screen.getByRole('dialog', { name: `person ${EZRA.entryId}` })).toBeTruthy();
  });

  it('a decline the server answers on the press is said in that row, and nothing is marked paid', async () => {
    open();
    const gina = await waitFor(() => row('Gina Declined'));
    fireEvent.click(within(gina).getByRole('button', { name: 'Try again' }));
    orgApi.chargeCardOnFile.mockResolvedValue({ data: { charge: { ...paid(GINA).data.charge, outcome: 'declined', reason: 'insufficient_funds', receiptNumber: null } } });
    fireEvent.click(within(gina).getByRole('button', { name: 'Charge $25.00' }));
    await within(gina).findByText(/Visa ending 1000 was declined\. The card did not have enough funds\./);
    expect(row('Nina Short').textContent).not.toContain('was declined. The card did not have enough funds. Nothing');
  });

  it('none: says so; Square not connected: the owner gets Connect Square, other staff are told who can', async () => {
    svc.list.mockResolvedValue(answer({ count: 0, totals: [], payments: [] }));
    open();
    await screen.findByText('No failed payments. When a card on file is declined, it is listed here.');
    cleanup();
    resetConsoleOrgs();
    svc.list.mockResolvedValue(answer({ count: 0, totals: [], payments: [], square: false }));
    open();
    fireEvent.click(await screen.findByRole('link', { name: 'Connect Square' }));
    await screen.findByText('The Settings page');
    cleanup();
    resetConsoleOrgs();
    open(FRONT_DESK);
    await screen.findByText('Cards on file are charged through Square. The owner can connect Square in Settings.');
    expect(screen.queryByRole('link', { name: 'Connect Square' })).toBeNull();
  });

  it('staff who do not record payments are told so, and the list is never asked for', async () => {
    open({ ...ORG, staffRole: 'trainer', privileges: ['members.read'] });
    await screen.findByText(/Recording payments isn't part of your role/);
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('Show more reads the next page and adds its rows once', async () => {
    svc.list.mockResolvedValueOnce(answer({ count: 5, payments: [GINA], next: 25 })).mockResolvedValueOnce(answer({ count: 5, payments: [GINA, NINA], next: null }));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(rows().length).toBe(2));
    expect(svc.list).toHaveBeenLastCalledWith('g1', 25);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});

describe("Overview's Failed payments line", () => {
  const draw = (privileges) =>
    render(
      <MemoryRouter initialEntries={['/console/iron-house']}>
        <Routes>
          <Route path="/console/:orgSlug" element={<FailedPaymentsCard gymId="g1" orgSlug="iron-house" privileges={privileges} />} />
          <Route path="/console/:orgSlug/failed-payments" element={<p>The Failed payments page</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('how many and how much, with a button that opens the list', async () => {
    draw(ORG.privileges);
    await screen.findByText('3 card payments were declined and are still owed.');
    expect(screen.getByText('$65.00 owed')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Open Failed payments' }));
    await screen.findByText('The Failed payments page');
  });

  it('nothing where there are none, and nothing asked for staff who do not record payments', async () => {
    svc.summary.mockResolvedValue({ count: 0, totals: [], square: true });
    draw(ORG.privileges);
    await waitFor(() => expect(svc.summary).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('failed-payments-card')).toBeNull();
    cleanup();
    svc.summary.mockClear();
    draw(['members.read']);
    expect(screen.queryByTestId('failed-payments-card')).toBeNull();
    expect(svc.summary).not.toHaveBeenCalled();
  });
});
