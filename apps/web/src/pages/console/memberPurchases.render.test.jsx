// WHAT A PERSON BOUGHT AT THE DESK, on their page (ROADMAP 18b-i). Only the network is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';

const svc = { purchases: vi.fn(), refundSale: vi.fn(), voidSaleRefund: vi.fn() };
vi.mock('../../api/registerApi', () => ({ registerService: svc }));

const MemberPurchases = (await import('./MemberPurchases')).default;

const GYM = { id: 'g1', slug: 'iron-house', staffRole: 'owner', privileges: ['members.confirm', 'billing.members'] };
const sale = (over = {}) => ({
  id: 's1',
  itemName: 'Water',
  quantity: 2,
  unitPriceMinor: 199,
  netMinor: 398,
  taxMinor: 33,
  totalMinor: 431,
  taxBp: 825,
  taxIncluded: false,
  currency: 'USD',
  method: 'cash',
  soldOn: '2026-10-12',
  soldAt: '2026-10-12T14:05:00.000Z',
  by: 'Sam Desk',
  person: { entryId: 'e1', name: 'Maya Patel' },
  undone: false,
  voided: null,
  canUndo: true,
  receiptNumber: 6 + Number(String(over.id ?? 's1').replace(/\D/g, '') || '0'),
  ...over,
});

function SellStub() {
  const { state } = useLocation();
  return <p>{`The Sell page for ${JSON.stringify(state)}`}</p>;
}
const open = (gym = GYM, past = false) =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/members']}>
      <Routes>
        <Route path="/console/:orgSlug/members" element={<MemberPurchases gymId="g1" gym={gym} entryId="e1" name="Maya Patel" past={past} />} />
        <Route path="/console/:orgSlug/sell" element={<SellStub />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('bought at the desk', () => {
  it('lists what they bought, a voided sale marked with who and why, and opens Sell with them already picked', async () => {
    svc.purchases.mockResolvedValue({
      sales: [sale(), sale({ id: 's0', quantity: 1, totalMinor: 215, taxMinor: 16, undone: true, voided: { reason: 'returned', on: '2026-10-12', by: 'Priya Desk' } })],
      notShown: 3,
    });
    open();
    const box = await screen.findByRole('region', { name: 'Bought at the desk' });
    expect(svc.purchases).toHaveBeenCalledWith('g1', 'e1');
    expect(within(box).getAllByTestId('purchase-row').map((r) => r.textContent)).toEqual(['2 × Water12 Oct 2026 · Cash · $0.33 tax$4.31View receipt', '1 × Water12 Oct 2026 · Cash · $0.16 taxVoided 12 October 2026 by Priya Desk · Brought back$2.15View receipt']);
    expect(within(box).getByText('Showing the newest 2.')).toBeTruthy();
    fireEvent.click(within(box).getByRole('link', { name: 'Sell a product to Maya Patel' }));
    expect(screen.getByText('The Sell page for {"sellTo":{"entryId":"e1","name":"Maya Patel","past":false}}')).toBeTruthy();
  });

  it('says so when nothing was bought', async () => {
    svc.purchases.mockResolvedValue({ sales: [], notShown: 0 });
    open();
    expect(await screen.findByText('Nothing yet. Products sold to them on the Sell page are listed here.')).toBeTruthy();
  });

  it('a read that fails is said in the box, and raises no alert on the person’s page', async () => {
    svc.purchases.mockRejectedValue(Object.assign(new Error('down'), { response: { status: 500, data: {} } }));
    open();
    const box = await screen.findByRole('region', { name: 'Bought at the desk' });
    expect(within(box).getByText("We couldn't load what they bought.")).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('drawn with no router around it, lists the purchases and offers no link', async () => {
    svc.purchases.mockResolvedValue({ sales: [sale()], notShown: 0 });
    render(<MemberPurchases gymId="g1" gym={GYM} entryId="e1" name="Maya Patel" past={false} />);
    const box = await screen.findByRole('region', { name: 'Bought at the desk' });
    expect(within(box).getAllByTestId('purchase-row')).toHaveLength(1);
    expect(within(box).queryByRole('link')).toBeNull();
  });

  it('is not drawn, and nothing is asked, for staff who cannot record a payment', () => {
    open({ ...GYM, staffRole: 'trainer', privileges: ['members.confirm'] });
    expect(screen.queryByRole('region', { name: 'Bought at the desk' })).toBeNull();
    expect(svc.purchases).not.toHaveBeenCalled();
  });
});

describe("refund a sale from the person's page (18p)", () => {
  it("a sale with money left has Refund sale in its ⋯; the refund is sent, said under the sale, and the list read again", async () => {
    svc.purchases.mockResolvedValue({ sales: [sale({ canUndo: false, canRefund: true, refundedMinor: 0, refunds: [] })], notShown: 0 });
    svc.refundSale.mockResolvedValue({ receiptNumber: 9 });
    open();
    const box = await screen.findByRole("region", { name: "Bought at the desk" });
    fireEvent.click(within(box).getByRole("button", { name: "More for the sale of 2 × Water" }));
    fireEvent.click(within(box).getByRole("menuitem", { name: /^Refund sale/ }));
    const form = within(box).getByTestId("sale-refund-form");
    fireEvent.change(within(form).getByLabelText("Why it was refunded"), { target: { value: "charged_too_much" } });
    svc.purchases.mockResolvedValue({ sales: [sale({ canUndo: false, canRefund: false, refundedMinor: 431, refunds: [] })], notShown: 0 });
    fireEvent.click(within(form).getByRole("button", { name: "Note refund" }));
    await waitFor(() => expect(svc.refundSale).toHaveBeenCalledWith("g1", "s1", { requestKey: expect.any(String), amountMinor: 431, method: "cash", reason: "charged_too_much", restock: 0 }));
    expect((await within(box).findByRole("status")).textContent).toBe("Refund noted: $4.31 back on the sale of 2 × Water. Its receipt is #9.");
    await waitFor(() => expect(svc.purchases).toHaveBeenCalledTimes(2));
    expect(await within(box).findByText("Refunded")).toBeTruthy();
  });

  it("a gym that needs a plan, or a voided sale, offers no Refund sale", async () => {
    svc.purchases.mockResolvedValue({ sales: [sale({ canRefund: true, refundedMinor: 0, refunds: [] })], notShown: 0 });
    open({ ...GYM, consoleReadOnly: true });
    const box = await screen.findByRole("region", { name: "Bought at the desk" });
    expect(within(box).queryByRole("button", { name: "More for the sale of 2 × Water" })).toBeNull();
    cleanup();
    svc.purchases.mockResolvedValue({ sales: [sale({ undone: true, canRefund: false, refunds: [] })], notShown: 0 });
    open();
    const voided = await screen.findByRole("region", { name: "Bought at the desk" });
    expect(within(voided).queryByRole("button", { name: "More for the sale of 2 × Water" })).toBeNull();
  });
});
