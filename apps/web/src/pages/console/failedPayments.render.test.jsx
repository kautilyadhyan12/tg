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
// The person's card box: here it saves a card on one press, as Square's form or a Terminal would.
vi.mock('./MemberCard', () => ({
  default: ({ entryId, onCardSaved }) => (
    <div aria-label={`card box ${entryId}`}>
      <button type="button" onClick={() => onCardSaved?.()}>
        Save the card
      </button>
    </div>
  ),
}));
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, payNow = null, onClose }) => (
    <div role="dialog" aria-label={`person ${entryId}`} data-pay-now={payNow === null ? 'none' : `${payNow.membershipId} ${String(payNow.feeBillId)}`}>
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
    expect(nina.textContent).toContain('Not enough funds');
    expect(nina.textContent).toContain('This card can be tried again from 2:15 PM on 24 Oct (Square recommends waiting 24 hours). Or add a new card, or take payment another way.');
    const ezra = row('Ezra Expired');
    expect(within(ezra).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(ezra.textContent).toContain('The bank declined this card permanently. Add a new card, or take payment another way.');
    expect(ezra.textContent).toContain('Past member');
    // Every row opens the person's page, where every other way to pay is.
    fireEvent.click(within(ezra).getByRole('button', { name: 'Open their page' }));
    expect(screen.getByRole('dialog', { name: `person ${EZRA.entryId}` })).toBeTruthy();
  });

  it('a card declined for good: Add a new card opens the card box under the row, and once saved the charge is offered there', async () => {
    const withCard = { ...EZRA, retry: { kind: 'charge', card: { brand: 'VISA', last4: '1111' }, payerName: null, expired: false, cardRef: 'ref-ezra-new', amountMinor: 2500 } };
    open();
    const ezra = await waitFor(() => row('Ezra Expired'));
    expect(within(ezra).queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(within(ezra).getByRole('button', { name: 'Add a new card' }));
    within(ezra).getByLabelText(`card box ${EZRA.entryId}`);
    // The list, read again once the card is saved, offers the charge on the new card.
    svc.list.mockResolvedValue(answer({ payments: [GINA, NINA, FAY, withCard] }));
    fireEvent.click(within(ezra).getByRole('button', { name: 'Save the card' }));
    const box = await within(row('Ezra Expired')).findByTestId('failed-payment-box');
    expect(box.textContent).toContain("Card saved. Charge Ezra Expired's new card now?");
    expect(box.textContent).toContain("$25.00 is charged to Ezra Expired's Visa ending 1111 as soon as you press Charge $25.00.");
    expect(orgApi.chargeCardOnFile).not.toHaveBeenCalled();
    orgApi.chargeCardOnFile.mockResolvedValue(paid(withCard, 35));
    fireEvent.click(within(box).getByRole('button', { name: 'Charge $25.00' }));
    await within(row('Ezra Expired')).findByText('Charged $25.00 to Visa ending 1111. Receipt 35.');
    expect(orgApi.chargeCardOnFile.mock.calls[0][3]).toMatchObject({ periodIndex: 1, amountMinor: 2500, cardRef: 'ref-ezra-new' });
  });

  it('a card waiting a day: Add a new card is offered there too, and the new card is charged at once', async () => {
    const newCard = { ...NINA, retry: { kind: 'charge', card: { brand: 'MASTERCARD', last4: '4444' }, payerName: null, expired: false, cardRef: 'ref-nina-new', amountMinor: 2500 } };
    open();
    const nina = await waitFor(() => row('Nina Short'));
    expect(within(nina).queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(within(nina).getByRole('button', { name: 'Add a new card' }));
    within(nina).getByLabelText(`card box ${NINA.entryId}`);
    svc.list.mockResolvedValue(answer({ payments: [GINA, newCard, FAY, EZRA] }));
    fireEvent.click(within(nina).getByRole('button', { name: 'Save the card' }));
    const box = await within(row('Nina Short')).findByTestId('failed-payment-box');
    expect(box.textContent).toContain("Card saved. Charge Nina Short's new card now?");
    orgApi.chargeCardOnFile.mockResolvedValue(paid(newCard, 36));
    fireEvent.click(within(box).getByRole('button', { name: 'Charge $25.00' }));
    await within(row('Nina Short')).findByText('Charged $25.00 to Mastercard ending 4444. Receipt 36.');
    expect(orgApi.chargeCardOnFile.mock.calls[0].slice(1, 3)).toEqual([NINA.entryId, NINA.membershipId]);
    expect(orgApi.chargeCardOnFile.mock.calls[0][3]).toMatchObject({ amountMinor: 2500, cardRef: 'ref-nina-new' });
  });

  it("Take payment opens that row's person with that row's own bill: a membership's, or a fee's", async () => {
    open();
    const fay = await waitFor(() => row('Fay Fee'));
    fireEvent.click(within(row('Nina Short')).getByRole('button', { name: 'Take payment' }));
    expect(screen.getByRole('dialog', { name: `person ${NINA.entryId}` }).getAttribute('data-pay-now')).toBe(`${NINA.membershipId} null`);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(within(fay).getByRole('button', { name: 'Take payment' }));
    expect(screen.getByRole('dialog', { name: `person ${FAY.entryId}` }).getAttribute('data-pay-now')).toBe(`${FAY.membershipId} ${FAY.billId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // Open their page opens the page alone.
    fireEvent.click(within(fay).getByRole('button', { name: 'Open their page' }));
    expect(screen.getByRole('dialog', { name: `person ${FAY.entryId}` }).getAttribute('data-pay-now')).toBe('none');
    expect(orgApi.chargeCardOnFile).not.toHaveBeenCalled();
    expect(orgApi.chargeFeeToCardOnFile).not.toHaveBeenCalled();
  });

  it('a decline the server answers on the press is said in that row, and nothing is marked paid', async () => {
    open();
    const gina = await waitFor(() => row('Gina Declined'));
    fireEvent.click(within(gina).getByRole('button', { name: 'Try again' }));
    orgApi.chargeCardOnFile.mockResolvedValue({ data: { charge: { ...paid(GINA).data.charge, outcome: 'declined', reason: 'insufficient_funds', receiptNumber: null } } });
    fireEvent.click(within(gina).getByRole('button', { name: 'Charge $25.00' }));
    await within(gina).findByText(/Visa ending 1000 was declined\. The card did not have enough funds\./);
    // Square asks for a day before the next try: no Try again on that row now.
    expect(within(gina).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(row('Nina Short').textContent).not.toContain('was declined. The card did not have enough funds. Nothing');
  });

  it('a card saved under a row on the second page: every page shown is read again, and the charge is offered under that row', async () => {
    const ezraNew = { ...EZRA, retry: { kind: 'charge', card: { brand: 'VISA', last4: '1111' }, payerName: null, expired: false, cardRef: 'ref-ezra-new', amountMinor: 2500 } };
    svc.list.mockImplementation((_, from = 0) => Promise.resolve(from === 0 ? answer({ count: 4, payments: [GINA, NINA, FAY], next: 25 }) : answer({ count: 4, payments: [EZRA], next: null })));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByText('Ezra Expired');
    const ezra = row('Ezra Expired');
    fireEvent.click(within(ezra).getByRole('button', { name: 'Add a new card' }));
    svc.list.mockImplementation((_, from = 0) => Promise.resolve(from === 0 ? answer({ count: 4, payments: [GINA, NINA, FAY], next: 25 }) : answer({ count: 4, payments: [ezraNew], next: null })));
    fireEvent.click(within(ezra).getByRole('button', { name: 'Save the card' }));
    const box = await within(row('Ezra Expired')).findByTestId('failed-payment-box');
    expect(box.textContent).toContain("Card saved. Charge Ezra Expired's new card now?");
    expect(svc.list).toHaveBeenLastCalledWith('g1', 25);
    expect(rows().length).toBe(4);
  });

  it('a press the server refuses as changed (409) reads the list again, so the row says what is true now', async () => {
    open();
    const gina = await waitFor(() => row('Gina Declined'));
    fireEvent.click(within(gina).getByRole('button', { name: 'Try again' }));
    const reads = svc.list.mock.calls.length;
    svc.list.mockResolvedValue(answer({ payments: [{ ...GINA, retry: { kind: 'wait', from: '2026-10-24T19:15:00.000Z' } }, NINA, FAY, EZRA] }));
    orgApi.chargeCardOnFile.mockRejectedValue(Object.assign(new Error('changed'), { response: { status: 409, data: { message: 'This card was declined less than a day ago.' } } }));
    fireEvent.click(within(gina).getByRole('button', { name: 'Charge $25.00' }));
    await waitFor(() => expect(svc.list.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(row('Gina Declined').textContent).toContain('This card can be tried again from'));
    expect(within(row('Gina Declined')).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a press whose answer was lost is never replayed: a new card, or the box opened again, sends a new key', async () => {
    open();
    const gina = await waitFor(() => row('Gina Declined'));
    fireEvent.click(within(gina).getByRole('button', { name: 'Try again' }));
    orgApi.chargeCardOnFile.mockRejectedValue(new Error('Network Error'));
    fireEvent.click(within(gina).getByRole('button', { name: 'Charge $25.00' }));
    await waitFor(() => expect(orgApi.chargeCardOnFile).toHaveBeenCalledTimes(1));
    await within(gina).findByRole('alert');
    fireEvent.click(within(gina).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(gina).getByRole('button', { name: 'Try again' }));
    fireEvent.click(within(gina).getByRole('button', { name: 'Charge $25.00' }));
    await waitFor(() => expect(orgApi.chargeCardOnFile).toHaveBeenCalledTimes(2));
    const [first, second] = orgApi.chargeCardOnFile.mock.calls.map((c) => c[3].requestKey);
    expect(second).not.toBe(first);
    // A new card saved under the row: its charge has a key of its own.
    await within(gina).findByRole('alert');
    fireEvent.click(within(gina).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(gina).getByRole('button', { name: 'Add a new card' }));
    fireEvent.click(within(gina).getByRole('button', { name: 'Save the card' }));
    fireEvent.click(await within(row('Gina Declined')).findByRole('button', { name: 'Charge $25.00' }));
    await waitFor(() => expect(orgApi.chargeCardOnFile).toHaveBeenCalledTimes(3));
    expect(new Set(orgApi.chargeCardOnFile.mock.calls.map((c) => c[3].requestKey)).size).toBe(3);
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
    await screen.findByText(`Failed payments needs "Record members' payments" and "Keep the member list and invite". Ask the owner to turn them on for you.`);
    expect(svc.list).not.toHaveBeenCalled();
    cleanup();
    resetConsoleOrgs();
    // Records payments, but does not keep the list: the same, never a page of presses they are refused.
    open({ ...ORG, staffRole: 'trainer', privileges: ['members.read', 'billing.members'] });
    await screen.findByText(/^Failed payments needs/);
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
