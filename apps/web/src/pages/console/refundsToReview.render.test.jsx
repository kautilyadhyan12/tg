// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({ list: vi.fn(), keepFee: vi.fn(), noRefund: vi.fn() }));
vi.mock('../../api/refundsToReviewApi', () => ({ refundsToReviewService: svc }));
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, refundNow, onClose }) => (
    <div role="dialog" aria-label={`person ${entryId}`} data-refund-now={refundNow === null ? 'none' : JSON.stringify(refundNow)}>
      <button type="button" onClick={onClose}>
        Close page
      </button>
    </div>
  ),
}));

const { default: RefundsToReviewCard } = await import('../../components/console/RefundsToReviewCard');
const { cardRefundOpenLine } = await import('./cardRefundView');
const { feeRow } = await import('./memberBillsView');
const { reviewAsk, reviewButtons, reviewDone, reviewHeadline, reviewWhat, reviewWhy } = await import('./refundsToReviewView');

const ENTRY = '11111111-1111-4111-8111-111111111111';
const HELD = '22222222-2222-4222-8222-222222222222';
const PAY = '33333333-3333-4333-8333-333333333333';
const FEE = '44444444-4444-4444-8444-444444444444';
const PRESS = '55555555-5555-4555-8555-555555555555';
const SALE = '66666666-6666-4666-8666-666666666666';
const BOTH = ['billing.members', 'members.confirm'];
const org = { id: '77777777-7777-4777-8777-777777777777', orgType: 'gym', slug: 'demo' };

const member = (over = {}) => ({ entryId: ENTRY, membershipId: HELD, paymentId: PAY, typeName: 'Gold Monthly', byHand: false, fee: null, ...over });
const noShow = { kind: 'no_show', of: 'class', forName: 'Spin', on: '2026-10-28', to: null };
const base = { id: FEE, kind: 'fee', amountMinor: 1000, paidMinor: 1000, currency: 'USD', name: 'Maya Patel', past: false, personDeleted: false, on: null, member: member({ fee: noShow }), sale: null };
const failed = { ...base, id: PRESS, kind: 'failed', name: 'Ravi Shah', amountMinor: 2500, paidMinor: 2500, on: '2026-10-30', member: member() };
const saleRow = { ...base, id: PRESS, kind: 'lost', name: null, amountMinor: 1200, paidMinor: 1200, on: '2026-10-30', member: null, sale: { saleId: SALE, day: '2026-10-30', item: 'Water bottle', more: 2 } };
const late = { ...failed, kind: 'late' };

function Sell() {
  const { state } = useLocation();
  return <p data-testid="sell">{JSON.stringify(state)}</p>;
}
const draw = (props = {}) =>
  render(
    <MemoryRouter initialEntries={['/console/demo']}>
      <Routes>
        <Route path="/console/demo" element={<RefundsToReviewCard org={org} orgSlug="demo" privileges={BOTH} readOnly={false} {...props} />} />
        <Route path="/console/demo/sell" element={<Sell />} />
      </Routes>
    </MemoryRouter>,
  );
const answer = (rows, over = {}) => ({ count: rows.length, rows, next: null, ...over });

beforeEach(() => {
  svc.list.mockReset();
  svc.keepFee.mockReset().mockResolvedValue({});
  svc.noRefund.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe('the words of a row', () => {
  it('a fee, part of a fee and a fee paid by hand', () => {
    expect(reviewWhat(base)).toBe('No-show fee · Spin on 28 October 2026');
    expect(reviewWhy(base)).toBe('No longer owed: they were marked Came, or the class was cancelled.');
    expect(reviewButtons(base)).toEqual({ open: 'Refund', decide: 'Keep the fee' });
    expect(reviewWhy({ ...base, amountMinor: 600 })).toBe('No longer owed: they were marked Came, or the class was cancelled. $6.00 of $10.00 is left to refund.');
    const byHand = { ...base, member: member({ fee: noShow, byHand: true }) };
    expect(reviewWhy(byHand)).toBe('No longer owed: they were marked Came, or the class was cancelled. If you gave the money back, void the payment.');
    expect(reviewButtons(byHand).open).toBe('Void payment');
  });

  it('failed, never answered and past 14 days', () => {
    expect(reviewWhat(failed)).toBe('Gold Monthly');
    expect(reviewWhy(failed)).toBe('Square could not refund this. No money went back.');
    expect(reviewButtons(failed)).toEqual({ open: 'Refund', decide: 'No refund needed' });
    expect(reviewWhat(saleRow)).toBe('Water bottle and 2 more');
    expect(reviewWhy(saleRow)).toBe("We don't know whether Square took this refund of 30 October 2026. Check your Square Dashboard. If it went through, press Refund and note it there.");
    expect(reviewWhy(late)).toBe('This refund has been pending for over 14 days. Contact Square Support.');
    expect(reviewButtons(late)).toEqual({ open: 'Open their page', decide: null });
    expect(reviewButtons({ ...saleRow, kind: 'late' })).toEqual({ open: 'Open Sell', decide: null });
  });

  it('the box says it comes off the list, where the decision is kept, and that a refund can still go', () => {
    expect(reviewAsk(base)).toEqual({
      question: "Keep Maya Patel's $10.00 no-show fee?",
      detail: "It comes off this list. Maya Patel's page will say who decided and when. You can still refund it from there.",
      button: 'Keep the fee',
    });
    expect(reviewAsk(saleRow)).toEqual({
      question: 'No refund needed for this $12.00 sale?',
      detail: 'It comes off this list. Sell will say who decided and when. You can still refund it from there.',
      button: 'No refund needed',
    });
    expect(reviewDone(base)).toBe('Fee kept. Maya Patel is off this list.');
    expect(reviewDone(failed)).toBe('No refund needed. Ravi Shah is off this list.');
    expect(reviewHeadline(0)).toBeNull();
    expect(reviewHeadline(1)).toBe('1 refund to review');
    expect(reviewHeadline(3)).toBe('3 refunds to review');
  });

  it('a person\'s page and Sell say who decided and when', () => {
    expect(cardRefundOpenLine({ amountMinor: 2500, on: '2026-10-30', lost: true, decided: { on: '2026-10-31', by: 'Sam Lee' } }, 'USD')).toBe('No refund needed on the $25.00 refund of 30 October 2026, decided by Sam Lee on 31 October 2026.');
    expect(cardRefundOpenLine({ amountMinor: 2500, on: '2026-10-30', lost: true, decided: { on: '2026-10-31', by: null } }, 'USD')).toBe('No refund needed on the $25.00 refund of 30 October 2026, decided on 31 October 2026.');
    const fee = { id: FEE, fee: 'no_show', of: 'class', forName: 'Spin', on: '2026-10-28', to: null, amountMinor: 1000, tax: null, dueOn: '2026-10-28', state: 'paid', waived: null, stillOwed: false, kept: { on: '2026-10-31', by: 'Sam Lee' }, refundedMinor: 0, payments: [{ id: PAY, method: 'company', amountMinor: 1000, paidOn: '2026-10-28', by: null, receiptNumber: 1, refunds: [], voidedRefunds: [], refundableMinor: 1000, cardRefund: null, card: null }], voidedPayments: [], can: { pay: false, waive: false, voidPaymentId: null } };
    expect(feeRow(fee, 'USD', '2026-10-31').waived).toBe('No longer owed: they were marked Came, or the class was cancelled. Kept by Sam Lee on 31 October 2026. To give the money back, press Refund on the payment.');
  });
});

describe('the card on Overview', () => {
  it('draws nothing with an empty list, a failed read, or staff who take no payments', async () => {
    svc.list.mockResolvedValue(answer([]));
    const { container } = draw();
    await waitFor(() => expect(svc.list).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup();
    svc.list.mockClear();
    const other = draw({ privileges: ['members.confirm'] });
    expect(other.container.textContent).toBe('');
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('Refund opens their page on that payment, and closing reads the list again', async () => {
    svc.list.mockResolvedValue(answer([base]));
    draw();
    const row = await screen.findByTestId('refund-review-row');
    expect(screen.getByTestId('refunds-to-review-headline').textContent).toBe('1 refund to review');
    fireEvent.click(within(row).getByRole('button', { name: 'Refund' }));
    const page = await screen.findByRole('dialog', { name: `person ${ENTRY}` });
    expect(JSON.parse(page.getAttribute('data-refund-now'))).toEqual({ membershipId: HELD, paymentId: PAY, voidFeeId: null });
    expect(svc.keepFee).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close page' }));
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it('Void payment names the fee, and a name opens their page with no box', async () => {
    svc.list.mockResolvedValue(answer([{ ...base, member: member({ fee: noShow, byHand: true }) }]));
    draw();
    const row = await screen.findByTestId('refund-review-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Void payment' }));
    expect(JSON.parse((await screen.findByRole('dialog')).getAttribute('data-refund-now')).voidFeeId).toBe(FEE);
    fireEvent.click(screen.getByRole('button', { name: 'Close page' }));
    fireEvent.click(await within(await screen.findByTestId('refund-review-row')).findByRole('button', { name: "Open Maya Patel's page" }));
    expect((await screen.findByRole('dialog')).getAttribute('data-refund-now')).toBe('none');
  });

  it("a sale's Refund opens Sell on that sale", async () => {
    svc.list.mockResolvedValue(answer([saleRow]));
    draw();
    fireEvent.click(await within(await screen.findByTestId('refund-review-row')).findByRole('button', { name: 'Refund' }));
    expect(JSON.parse((await screen.findByTestId('sell')).textContent)).toEqual({ refundSale: { saleId: SALE, day: '2026-10-30', open: true } });
  });

  it('Keep the fee asks first, Back leaves nothing, then it is said in the same card once the row has gone', async () => {
    svc.list.mockResolvedValueOnce(answer([base])).mockResolvedValue(answer([]));
    draw();
    const row = await screen.findByTestId('refund-review-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Keep the fee' }));
    const ask = screen.getByTestId('refund-review-ask');
    expect(ask.textContent).toContain('You can still refund it from there.');
    expect(svc.keepFee).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('refund-review-ask')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Keep the fee' }));
    fireEvent.click(within(screen.getByTestId('refund-review-ask')).getByRole('button', { name: 'Keep the fee' }));
    expect((await screen.findByTestId('refunds-to-review-said')).textContent).toBe('Fee kept. Maya Patel is off this list.');
    expect(svc.keepFee).toHaveBeenCalledWith(org.id, FEE);
    await waitFor(() => expect(screen.queryByTestId('refund-review-row')).toBeNull());
  });

  it('No refund needed goes by the press, and a row that changed says so and reads again', async () => {
    svc.list.mockResolvedValue(answer([failed]));
    svc.noRefund.mockRejectedValueOnce({ response: { status: 409, data: { error: 'refund_review_changed', message: 'This has changed since the list was read. The list now shows what is left to do.' } } });
    draw();
    fireEvent.click(await within(await screen.findByTestId('refund-review-row')).findByRole('button', { name: 'No refund needed' }));
    fireEvent.click(within(screen.getByTestId('refund-review-ask')).getByRole('button', { name: 'No refund needed' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('This has changed'));
    expect(svc.noRefund).toHaveBeenCalledWith(org.id, PRESS);
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it('a gym that can only read sees the rows and presses nothing', async () => {
    svc.list.mockResolvedValue(answer([base]));
    draw({ readOnly: true });
    const row = await screen.findByTestId('refund-review-row');
    expect(within(row).getByRole('button', { name: 'Refund' }).disabled).toBe(true);
    expect(within(row).getByRole('button', { name: 'Keep the fee' }).disabled).toBe(true);
  });

  it('Show more adds the next page under the first', async () => {
    svc.list.mockResolvedValueOnce(answer([base], { count: 2, next: 10 })).mockResolvedValueOnce(answer([failed], { count: 2, next: null }));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getAllByTestId('refund-review-row')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
