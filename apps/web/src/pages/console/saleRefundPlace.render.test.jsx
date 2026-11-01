// CHOOSE PRODUCT (ROADMAP 18d-iv-d-ii): a refund made in Square on part of a basket, on a person's "Bought at the desk". Only the network is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const svc = { purchases: vi.fn(), placeSquareRefund: vi.fn() };
vi.mock('../../api/registerApi', () => ({ registerService: svc }));

const MemberPurchases = (await import('./MemberPurchases')).default;

const GYM = { id: 'g1', slug: 'iron-house', staffRole: 'owner', privileges: ['members.confirm', 'billing.members'] };
const PRESS = '00000000-0000-4000-8000-000000000001';
const base = { unitPriceMinor: 400, netMinor: 400, taxMinor: 0, taxBp: 0, taxIncluded: false, currency: 'USD', method: 'terminal', soldOn: '2026-10-12', soldAt: '2026-10-12T14:05:00.000Z', by: 'Sam', person: { entryId: 'e1', name: 'Maya' }, undone: false, voided: null, canUndo: false, canRefund: true, toCard: true, cardRefund: null, refunds: [], refundedMinor: 0, receiptNumber: 7, toPlace: [] };
const press = (over = {}) => ({ pressId: PRESS, amountMinor: 300, on: '2026-10-13', room: [{ saleId: 's1', minor: 400 }, { saleId: 's2', minor: 1500 }], ...over });
const water = (over = {}) => ({ ...base, id: 's1', itemName: 'Water', quantity: 2, totalMinor: 400, stockCounted: true, lineNo: 1, toPlace: [press()], ...over });
const towel = (over = {}) => ({ ...base, id: 's2', itemName: 'Towel', quantity: 1, totalMinor: 1500, stockCounted: false, lineNo: 2, ...over });

const draw = async (sales) => {
  svc.purchases.mockResolvedValue({ sales, notShown: 0 });
  render(
    <MemoryRouter>
      <MemberPurchases gymId="g1" gym={GYM} entryId="e1" name="Maya" past={false} />
    </MemoryRouter>,
  );
  return await screen.findByTestId('sale-refund-to-place');
};
const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Choose product' }));
  return within(await screen.findByTestId('place-refund-form'));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Choose product', () => {
  it('says what happened on the sale, and Back leaves the sentence and its button', async () => {
    const line = await draw([water(), towel()]);
    expect(line.textContent).toContain('Square refunded $3.00 of this sale. Which product was it for?');
    const box = await open();
    fireEvent.click(box.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('place-refund-form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose product' })).toBeTruthy();
  });

  it('asks for a product first, then sends it with the shelf count, and says so in the sale', async () => {
    svc.placeSquareRefund.mockResolvedValue({ receiptNumbers: [12] });
    await draw([water(), towel()]);
    const box = await open();
    fireEvent.click(box.getByRole('button', { name: 'Save' }));
    expect(await box.findByText('Pick the product.')).toBeTruthy();
    expect(svc.placeSquareRefund).not.toHaveBeenCalled();
    fireEvent.change(box.getByLabelText('Which product was it for?'), { target: { value: 's1' } });
    fireEvent.change(box.getByLabelText('Water: how many went back on the shelf'), { target: { value: '1' } });
    fireEvent.click(box.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The $3.00 refund is now on Water. Its receipt is #12.')).toBeTruthy();
    expect(svc.placeSquareRefund).toHaveBeenCalledWith('g1', 's1', PRESS, { parts: [{ saleId: 's1', amountMinor: 300, restock: 1 }] });
  });

  it('offers the product a replaced note frees, by what the server says it can take', async () => {
    await draw([water({ refundedMinor: 300, canRefund: true, toPlace: [press({ amountMinor: 400, room: [{ saleId: 's1', minor: 400 }, { saleId: 's2', minor: 1500 }] })] }), towel()]);
    const box = await open();
    const names = within(box.getByLabelText('Which product was it for?')).getAllByRole('option').map((o) => o.textContent);
    expect(names.some((n) => n.includes('Water'))).toBe(true);
  });

  it('more than is left on the sale: it asks only which product, with no amount that is not true', async () => {
    const room = [{ saleId: 's1', minor: 300 }, { saleId: 's2', minor: 300 }];
    await draw([water({ refundedMinor: 400, toPlace: [press({ room })] }), towel({ refundedMinor: 1500 })]);
    const box = await open();
    expect(box.getByText('Square refunded more than is left on this sale. Choose the product it was for.')).toBeTruthy();
    const names = within(box.getByLabelText('Which product was it for?')).getAllByRole('option').map((o) => o.textContent);
    expect(names).toContain('2 × Water');
    expect(names.join()).not.toContain('can be refunded');
  });

  it('a change somebody else made closes the box and says so', async () => {
    svc.placeSquareRefund.mockRejectedValue({ response: { status: 409, data: { error: 'place_refund_changed', message: 'This refund has changed since the page was read. The page now shows what is left to do.' } } });
    await draw([water(), towel()]);
    const box = await open();
    fireEvent.change(box.getByLabelText('Which product was it for?'), { target: { value: 's2' } });
    fireEvent.click(box.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/has changed since the page was read/)).toBeTruthy();
    expect(screen.queryByTestId('place-refund-form')).toBeNull();
    expect(svc.purchases.mock.calls.length).toBeGreaterThan(1);
  });
});
