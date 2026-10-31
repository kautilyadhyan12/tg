// REFUND TO CARD ON A SALE (ROADMAP 18d-iv-b-ii): a sale paid on the Terminal, on a person's "Bought at the desk", and the
// sentences Sell's list shares. Only the network is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const svc = { purchases: vi.fn(), refundSale: vi.fn(), refundWholeSale: vi.fn(), voidSaleRefund: vi.fn(), getCardRefund: vi.fn(), refundToCard: vi.fn(), getWholeCardRefund: vi.fn(), refundWholeToCard: vi.fn() };
vi.mock('../../api/registerApi', () => ({ registerService: svc }));

const MemberPurchases = (await import('./MemberPurchases')).default;
const { saleBasketMenu } = await import('./saleRefundMenu');
const { basketRefundTag } = await import('./sellView');
const { saleCardRefundWords, saleOpenLine, saleRefundLines, saleSaidNow, salesWaitOnSquare } = await import('./saleRefundView');

const GYM = { id: 'g1', slug: 'iron-house', staffRole: 'owner', privileges: ['members.confirm', 'billing.members'] };
const VISA = { brand: 'VISA', last4: '1111' };
const PRESS = '00000000-0000-4000-8000-000000000001';
const sale = (over = {}) => ({
  id: 's1',
  itemName: 'Water',
  quantity: 2,
  unitPriceMinor: 200,
  netMinor: 400,
  taxMinor: 0,
  totalMinor: 400,
  taxBp: 0,
  taxIncluded: false,
  currency: 'USD',
  method: 'terminal',
  soldOn: '2026-10-12',
  soldAt: '2026-10-12T14:05:00.000Z',
  by: 'Sam Desk',
  person: { entryId: 'e1', name: 'Maya Patel' },
  undone: false,
  voided: null,
  canUndo: false,
  canRefund: true,
  toCard: true,
  cardRefund: null,
  refunds: [],
  refundedMinor: 0,
  stockCounted: true,
  lineNo: 1,
  receiptNumber: 7,
  ...over,
});
const towel = (over = {}) => sale({ id: 's2', itemName: 'Towel', quantity: 1, unitPriceMinor: 1500, netMinor: 1500, totalMinor: 1500, stockCounted: false, lineNo: 2, ...over });
const refund = (over = {}) => ({
  id: 'r1',
  amountMinor: 400,
  method: 'terminal',
  reason: 'returned',
  restocked: 1,
  refundedOn: '2026-10-13',
  by: 'Sam Desk',
  receiptNumber: 8,
  voided: null,
  square: { state: 'pending', card: VISA, late: false, pressId: PRESS },
  ...over,
});

const draw = (sales, props = {}) => {
  svc.purchases.mockResolvedValue({ sales, notShown: 0 });
  render(
    <MemoryRouter>
      <MemberPurchases gymId="g1" gym={GYM} entryId="e1" name="Maya Patel" past={false} {...props} />
    </MemoryRouter>,
  );
};
const pressRefund = async (name) => {
  fireEvent.click(await screen.findByRole('button', { name: /^Refund the sale of/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`^${name}`) }));
};
const boxOpen = async () => {
  await screen.findByTestId('card-refund-box');
  await waitFor(() => expect(screen.queryByText('Checking this payment with Square.')).toBeNull());
  return within(screen.getByTestId('card-refund-box'));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a sale paid on the Terminal', () => {
  it('says Refund, with Refund to card and Note a refund; a sale paid by hand keeps its ⋯ and Refund sale', async () => {
    draw([sale()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Refund the sale of 2 × Water' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Refund to cardSquare sends the money back to the card that paid.', 'Note a refundYou gave it back another way, such as cash.']);
    cleanup();
    draw([sale({ method: 'cash', toCard: false })]);
    fireEvent.click(await screen.findByRole('button', { name: 'More for the sale of 2 × Water' }));
    expect((await screen.findAllByRole('menuitem')).map((i) => i.textContent)).toEqual(['Refund saleYou gave some or all of the money back.']);
  });

  it('nothing to offer once all of it went back', async () => {
    draw([sale({ canRefund: false, toCard: false, refundedMinor: 400, refunds: [refund({ square: { state: 'completed', card: VISA, late: false, pressId: PRESS } })] })]);
    await screen.findByText('Refunded');
    expect(screen.queryByRole('button', { name: /sale of/ })).toBeNull();
  });

  it('the box names the card and what is left, asks about the shelf, and sends the press once, said under the sale', async () => {
    svc.getCardRefund.mockResolvedValue({ card: VISA, leftMinor: 400, refundedInSquareMinor: 0, block: null });
    svc.refundToCard.mockResolvedValue({ step: 'pending', amountMinor: 400, currency: 'USD', card: VISA, pressId: PRESS });
    draw([sale()]);
    await pressRefund('Refund to card');
    const box = await boxOpen();
    expect(box.getByText('Refund 2 × Water to the card')).toBeTruthy();
    expect(box.getByText('Sold on 12 Oct 2026 to Maya Patel for $4.00. Square does not give back its card fee on a refund. It can take up to 14 business days to reach the card, depending on the bank.')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Refund $4.00 to Visa ending 1111' }));
    expect(await box.findByRole('alert')).toBeTruthy();
    expect(svc.refundToCard).not.toHaveBeenCalled();
    fireEvent.change(box.getByLabelText('Why it is being refunded'), { target: { value: 'returned' } });
    fireEvent.change(box.getByLabelText('How many went back on the shelf'), { target: { value: '2' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $4.00 to Visa ending 1111' }));
    await waitFor(() => expect(svc.refundToCard).toHaveBeenCalledTimes(1));
    expect(svc.refundToCard.mock.calls[0].slice(0, 2)).toEqual(['g1', 's1']);
    expect(svc.refundToCard.mock.calls[0][2]).toMatchObject({ amountMinor: 400, reason: 'returned', restock: 2 });
    expect((await screen.findByRole('status')).textContent).toMatch(/^Square is processing this \$4\.00 refund to Visa ending 1111\./);
    expect(screen.queryByTestId('card-refund-box')).toBeNull();
  });

  it('a product whose stock is not counted is not asked about the shelf, and still sends none', async () => {
    svc.getCardRefund.mockResolvedValue({ card: VISA, leftMinor: 1500, refundedInSquareMinor: 0, block: null });
    svc.refundToCard.mockResolvedValue({ step: 'pending', amountMinor: 1500, currency: 'USD', card: VISA, pressId: PRESS });
    draw([towel({ lineNo: 1 })]);
    await pressRefund('Refund to card');
    const box = await boxOpen();
    expect(box.queryByLabelText('How many went back on the shelf')).toBeNull();
    fireEvent.change(box.getByLabelText('Why it is being refunded'), { target: { value: 'faulty' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $15.00 to Visa ending 1111' }));
    await waitFor(() => expect(svc.refundToCard).toHaveBeenCalledTimes(1));
    expect(svc.refundToCard.mock.calls[0][2]).toMatchObject({ restock: 0 });
  });

  it('a sale of several products asks which product first, and its box is for that one alone', async () => {
    svc.getCardRefund.mockResolvedValue({ card: VISA, leftMinor: 1500, refundedInSquareMinor: 0, block: null });
    draw([sale(), towel()]);
    await pressRefund('Refund to card');
    expect(screen.queryByTestId('card-refund-box')).toBeNull();
    fireEvent.change(await screen.findByLabelText('Which product was it for?'), { target: { value: 's2' } });
    const box = await boxOpen();
    expect(svc.getCardRefund).toHaveBeenCalledWith('g1', 's2');
    expect(box.getByText('Refund 1 × Towel to the card')).toBeTruthy();
  });

  it('All products comes first on a sale of several: no amount is asked, each counted product asks about its shelf, and one press goes', async () => {
    svc.getWholeCardRefund.mockResolvedValue({ card: VISA, leftMinor: 1900, refundedInSquareMinor: 0, block: null });
    svc.refundWholeToCard.mockResolvedValue({ step: 'pending', amountMinor: 1900, currency: 'USD', card: VISA, pressId: PRESS });
    draw([sale(), towel()]);
    await pressRefund('Refund to card');
    const list = await screen.findByLabelText('Which product was it for?');
    expect(Array.from(list.options).map((o) => o.textContent)).toEqual(['Choose one', 'All products · $19.00 can be refunded', '2 × Water · $4.00 can be refunded', '1 × Towel · $15.00 can be refunded']);
    fireEvent.change(list, { target: { value: 'all' } });
    const box = await boxOpen();
    expect(svc.getWholeCardRefund).toHaveBeenCalledWith('g1', 's1');
    expect(box.getByText('Refund all of this sale to the card')).toBeTruthy();
    expect(box.queryByLabelText(/Amount to refund/)).toBeNull();
    expect(box.queryByLabelText('Towel: how many went back on the shelf')).toBeNull();
    fireEvent.change(box.getByLabelText('Why it is being refunded'), { target: { value: 'returned' } });
    fireEvent.change(box.getByLabelText('Water: how many went back on the shelf'), { target: { value: '2' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $19.00 to Visa ending 1111' }));
    await waitFor(() => expect(svc.refundWholeToCard).toHaveBeenCalledTimes(1));
    expect(svc.refundWholeToCard.mock.calls[0].slice(0, 2)).toEqual(['g1', 's1']);
    expect(svc.refundWholeToCard.mock.calls[0][2]).toMatchObject({ amountMinor: 1900, reason: 'returned', shelf: [{ saleId: 's1', count: 2 }] });
    expect((await screen.findByRole('status')).textContent).toMatch(/^Square is processing this \$19\.00 refund to Visa ending 1111\./);
  });

  it('with one product left, it asks no product and names it; All products is for two or more', async () => {
    svc.getCardRefund.mockResolvedValue({ card: VISA, leftMinor: 1500, refundedInSquareMinor: 0, block: null });
    draw([sale({ canRefund: false, toCard: false, refundedMinor: 400 }), towel()]);
    await pressRefund('Refund to card');
    const list = await screen.findByLabelText('Which product was it for?');
    expect(Array.from(list.options).map((o) => o.textContent)).toEqual(['Choose one', '1 × Towel · $15.00 can be refunded']);
  });

  it('Note a refund on All products: how and why, no amount, and its receipts said under the sale', async () => {
    svc.refundWholeSale.mockResolvedValue({ receiptNumbers: [12, 13] });
    draw([sale(), towel()]);
    await pressRefund('Note a refund');
    fireEvent.change(await screen.findByLabelText('Which product was it for?'), { target: { value: 'all' } });
    const form = within(await screen.findByTestId('sale-refund-all-form'));
    expect(form.getByText('Refund all of this sale')).toBeTruthy();
    expect(form.getByText('Sold on 12 Oct 2026 to Maya Patel for $19.00. $19.00 will be noted as refunded. This only writes the refund in your records: give the money back yourself.')).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Note refund' }));
    expect((await form.findByRole('alert')).textContent).toBe('Pick how you gave it back.');
    expect(svc.refundWholeSale).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('How you gave it back'), { target: { value: 'cash' } });
    fireEvent.change(form.getByLabelText('Why it was refunded'), { target: { value: 'faulty' } });
    fireEvent.change(form.getByLabelText('Water: how many went back on the shelf'), { target: { value: '1' } });
    fireEvent.click(form.getByRole('button', { name: 'Note refund' }));
    await waitFor(() => expect(svc.refundWholeSale).toHaveBeenCalledTimes(1));
    expect(svc.refundWholeSale.mock.calls[0][2]).toMatchObject({ totalMinor: 1900, method: 'cash', reason: 'faulty', shelf: [{ saleId: 's1', count: 1 }] });
    expect((await screen.findByRole('status')).textContent).toBe('Refund noted: $19.00 back on all of this sale. Its receipts are #12 and #13.');
  });

  it('where Square shows less left, Note a refund goes back to the products, with no All products, and the note has an amount to type', async () => {
    svc.getWholeCardRefund.mockResolvedValue({ card: VISA, leftMinor: 1600, refundedInSquareMinor: 300, block: 'less_in_square' });
    draw([sale(), towel()]);
    await pressRefund('Refund to card');
    fireEvent.change(await screen.findByLabelText('Which product was it for?'), { target: { value: 'all' } });
    const box = await boxOpen();
    expect(box.getByText(/refund one product at a time/)).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Note a refund' }));
    await screen.findByText('Pick the product, then type what Square gave back.');
    const list = screen.getByLabelText('Which product was it for?');
    expect(list.value).toBe('');
    expect(Array.from(list.options).map((o) => o.textContent)).toEqual(['Choose one', '2 × Water · $4.00 can be refunded', '1 × Towel · $15.00 can be refunded']);
    expect(screen.queryByTestId('sale-refund-all-form')).toBeNull();
    expect(screen.queryByTestId('card-refund-box')).toBeNull();
    fireEvent.change(list, { target: { value: 's2' } });
    const form = within(await screen.findByTestId('sale-refund-form'));
    expect(form.getByLabelText('Amount given back (USD)')).toBeTruthy();
  });

  it('where Square can refund nothing, Note a refund stays on all of the sale, saying the amount', async () => {
    svc.getWholeCardRefund.mockResolvedValue({ card: VISA, leftMinor: 0, refundedInSquareMinor: 0, block: 'too_old' });
    draw([sale(), towel()]);
    await pressRefund('Refund to card');
    fireEvent.change(await screen.findByLabelText('Which product was it for?'), { target: { value: 'all' } });
    const box = await boxOpen();
    fireEvent.click(box.getByRole('button', { name: 'Note a refund' }));
    expect(within(await screen.findByTestId('sale-refund-all-form')).getByText(/\$19\.00 will be noted as refunded/)).toBeTruthy();
  });

  it('a note on one product does not carry over: another product picked is Refund to card again', async () => {
    svc.getCardRefund.mockImplementation((_, saleId) => Promise.resolve(saleId === 's1' ? { card: VISA, leftMinor: 0, refundedInSquareMinor: 0, block: 'too_old' } : { card: VISA, leftMinor: 1500, refundedInSquareMinor: 0, block: null }));
    draw([sale(), towel()]);
    await pressRefund('Refund to card');
    fireEvent.change(await screen.findByLabelText('Which product was it for?'), { target: { value: 's1' } });
    const box = await boxOpen();
    fireEvent.click(box.getByRole('button', { name: 'Note a refund' }));
    await screen.findByTestId('sale-refund-form');
    fireEvent.change(screen.getByLabelText('Which product was it for?'), { target: { value: 's2' } });
    const next = await boxOpen();
    expect(next.getByText('Refund 1 × Towel to the card')).toBeTruthy();
  });

  it('Square refuses the press: the box says so, and the next press is a new one', async () => {
    svc.getCardRefund.mockResolvedValue({ card: VISA, leftMinor: 400, refundedInSquareMinor: 0, block: null });
    svc.refundToCard.mockRejectedValueOnce({ response: { status: 409, data: { error: 'card_refund_refused', message: 'Square refused this refund. No money went back.' } } });
    svc.refundToCard.mockResolvedValueOnce({ step: 'pending', amountMinor: 400, currency: 'USD', card: VISA, pressId: PRESS });
    draw([sale()]);
    await pressRefund('Refund to card');
    const box = await boxOpen();
    fireEvent.change(box.getByLabelText('Why it is being refunded'), { target: { value: 'returned' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $4.00 to Visa ending 1111' }));
    expect((await box.findByRole('alert')).textContent).toBe('Square refused this refund. No money went back.');
    fireEvent.click(box.getByRole('button', { name: 'Refund $4.00 to Visa ending 1111' }));
    await waitFor(() => expect(svc.refundToCard).toHaveBeenCalledTimes(2));
    expect(svc.refundToCard.mock.calls[1][2].requestKey).not.toBe(svc.refundToCard.mock.calls[0][2].requestKey);
  });

  it('no answer from Square on a sale says to open the sale again', async () => {
    svc.getCardRefund.mockResolvedValue({ card: VISA, leftMinor: 400, refundedInSquareMinor: 0, block: null });
    svc.refundToCard.mockRejectedValue(new Error('network'));
    draw([sale()]);
    await pressRefund('Refund to card');
    const box = await boxOpen();
    fireEvent.change(box.getByLabelText('Why it is being refunded'), { target: { value: 'returned' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $4.00 to Visa ending 1111' }));
    expect((await box.findByRole('alert')).textContent).toBe("We couldn't reach Square. The refund may not have gone through: open the sale again before trying.");
  });

  it('where Square cannot refund it, the box says so and Note a refund opens on the same product', async () => {
    svc.getCardRefund.mockResolvedValue({ card: VISA, leftMinor: 0, refundedInSquareMinor: 0, block: 'too_old' });
    draw([sale()]);
    await pressRefund('Refund to card');
    const box = await boxOpen();
    fireEvent.click(box.getByRole('button', { name: 'Note a refund' }));
    const form = within(await screen.findByTestId('sale-refund-form'));
    expect(form.getByText('Refund sale: 2 × Water')).toBeTruthy();
    expect(form.getByText(/give the money back yourself/)).toBeTruthy();
    expect(screen.queryByText(/Square Dashboard/)).toBeNull();
  });

  it('with Square not connected, the box opens the place to connect it for whoever may, and says who can for anybody else', async () => {
    svc.getCardRefund.mockRejectedValue({ response: { status: 409, data: { error: 'card_not_ready', message: 'Square is not connected.' } } });
    draw([sale()], { gym: { ...GYM, privileges: [...GYM.privileges, 'org.manage'] } });
    await pressRefund('Refund to card');
    const place = await screen.findByRole('link', { name: 'Open Square settings' });
    expect(place.getAttribute('href')).toContain('/console/iron-house/');
    cleanup();
    draw([sale()]);
    await pressRefund('Refund to card');
    expect(await screen.findByText('Ask the owner to connect Square.')).toBeTruthy();
  });

  it('a refund sent to the card offers no Void refund; one noted by hand does', async () => {
    const noted = refund({ id: 'r2', method: 'cash', amountMinor: 100, receiptNumber: 9, square: null, restocked: 0 });
    draw([sale({ refundedMinor: 500, totalMinor: 900, refunds: [refund({ square: { state: 'completed', card: VISA, late: false, pressId: PRESS } }), noted] })]);
    const lines = await screen.findAllByTestId('sale-refund');
    expect(within(lines[0]).queryByRole('button', { name: /^More for the refund/ })).toBeNull();
    expect(within(lines[1]).getByRole('button', { name: /^More for the refund/ })).toBeTruthy();
  });

  it('reads again by itself while Square has not finished, and the tag and the sentence follow', async () => {
    const done = { state: 'completed', card: VISA, late: false, pressId: PRESS };
    draw([sale({ refundedMinor: 400, refunds: [refund()] })], { squareEveryMs: 5 });
    await screen.findByText('Refund pending');
    expect(screen.getByText('$4.00 refund pending')).toBeTruthy();
    svc.purchases.mockResolvedValue({ sales: [sale({ refundedMinor: 400, canRefund: false, toCard: false, refunds: [refund({ square: done })] })], notShown: 0 });
    await screen.findByText('Refunded');
    expect(screen.getByText('$4.00 refunded')).toBeTruthy();
  });

  it('says when Square has not answered, and when nobody knows', async () => {
    draw([sale({ cardRefund: { amountMinor: 400, on: '2026-10-13', lost: false } })]);
    expect((await screen.findByTestId('sale-card-refund-open')).textContent).toBe("A refund of $4.00 is waiting for Square's answer.");
    cleanup();
    draw([sale({ cardRefund: { amountMinor: 400, on: '2026-10-13', lost: true } })]);
    expect((await screen.findByTestId('sale-card-refund-open')).textContent).toMatch(/^We don't know whether Square took the \$4\.00 refund/);
  });
});

describe('the sentences of a sale refunded to the card', () => {
  const basket = (lines) => ({ first: lines[0], lines, receiptNumber: 7, totalMinor: lines.reduce((n, l) => n + l.totalMinor, 0) });

  it.each([
    ['nothing', [], null],
    ['part, finished', [refund({ amountMinor: 100, square: { state: 'completed', card: VISA, late: false, pressId: PRESS } })], 'Part refunded'],
    ['all, finished', [refund({ square: { state: 'completed', card: VISA, late: false, pressId: PRESS } })], 'Refunded'],
    ['part, with Square', [refund({ amountMinor: 100 })], 'Refund pending'],
    ['all, with Square', [refund()], 'Refund pending'],
    ['failed', [refund({ voided: { reason: 'square_failed', on: '2026-10-13', by: null } })], null],
  ])('the tag: %s', (_, refunds, tag) => {
    const standing = refunds.filter((r) => r.voided === null).reduce((n, r) => n + r.amountMinor, 0);
    expect(basketRefundTag(basket([sale({ refunds, refundedMinor: standing })]))).toBe(tag);
  });

  it('one product still with Square makes the whole sale read Refund pending', () => {
    const finished = sale({ refundedMinor: 400, refunds: [refund({ square: { state: 'completed', card: VISA, late: false, pressId: PRESS } })] });
    expect(basketRefundTag(basket([finished, towel({ refundedMinor: 100, refunds: [refund({ id: 'r3', amountMinor: 100 })] })]))).toBe('Refund pending');
  });

  it('a refund line: the card, the wait past 14 days, and a failure in plain words', () => {
    const [line] = saleRefundLines(sale({ refunds: [refund({ square: { state: 'pending', card: VISA, late: true, pressId: PRESS } })] }));
    expect(line).toMatchObject({ amount: '$4.00 refund pending', toCard: true, note: 'This refund has been pending for over 14 days. Contact Square Support.' });
    expect(line.detail).toContain('Visa ending 1111');
    const [failed] = saleRefundLines(sale({ refunds: [refund({ voided: { reason: 'square_failed', on: '2026-10-13', by: null } })] }));
    expect(failed).toMatchObject({ amount: '$4.00 refunded', voided: 'Square could not refund this. No money went back.' });
  });

  it('the box says what Square gave back with no note here, and what is left', () => {
    const words = saleCardRefundWords(towel(), null, { card: VISA, leftMinor: 100, refundedInSquareMinor: 1800, block: null });
    expect(words.detail).toContain('to a walk-in for $15.00. $1.00 of it can still be refunded.');
    expect(words.inSquare).toBe('Square shows $18.00 of this sale was already refunded there. Note that refund here so your records match.');
  });

  it('what waits on Square', () => {
    expect(salesWaitOnSquare(undefined)).toBe(false);
    expect(salesWaitOnSquare([sale()])).toBe(false);
    expect(salesWaitOnSquare([sale({ cardRefund: { amountMinor: 1, on: '2026-10-13', lost: true } })])).toBe(false);
    expect(salesWaitOnSquare([sale({ cardRefund: { amountMinor: 1, on: '2026-10-13', lost: false } })])).toBe(true);
    expect(salesWaitOnSquare([sale({ refunds: [refund()] })])).toBe(true);
    expect(salesWaitOnSquare([sale({ refunds: [refund({ voided: { reason: 'square_failed', on: '2026-10-13', by: null } })] })])).toBe(false);
    expect(saleOpenLine(sale())).toBeNull();
  });

  it('the sentence under a sale follows its own press on its own product, never a line for anything else', () => {
    const sent = { step: 'pending', amountMinor: 400, currency: 'USD', cardWords: 'Visa ending 1111', pressId: PRESS, saleId: 's1' };
    const finished = refund({ square: { state: 'completed', card: VISA, late: false, pressId: PRESS } });
    expect(saleSaidNow({ words: 'noted', sent: null }, basket([sale()]), true)).toBe('noted');
    expect(saleSaidNow({ words: 'said', sent }, basket([sale({ refunds: [finished] }), towel()]), true)).toMatch(/^\$4\.00 was refunded to Visa ending 1111\./);
    expect(saleSaidNow({ words: 'said', sent }, basket([sale({ refunds: [refund({ voided: { reason: 'square_failed', on: '2026-10-13', by: null } })] })]), true)).toBeNull();
  });

  it('the button is on the sale only while some of it can go back to the card', () => {
    expect(saleBasketMenu(null, 'x', () => undefined).items).toEqual([]);
    expect(saleBasketMenu(basket([sale({ canRefund: false, toCard: false })]), 'x', () => undefined)).toMatchObject({ label: null, items: [] });
    const picks = [];
    const menu = saleBasketMenu(basket([sale({ canRefund: false, toCard: false }), towel()]), 'x', (toCard) => picks.push(toCard));
    menu.items.forEach((item) => item.onPick());
    expect(menu.label).toBe('Refund');
    expect(picks).toEqual([true, false]);
  });
});
