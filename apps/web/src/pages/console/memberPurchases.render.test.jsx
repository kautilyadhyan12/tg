// WHAT A PERSON BOUGHT AT THE DESK, on their page (ROADMAP 18b-i). Only the network is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';

const svc = { purchases: vi.fn() };
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
  canUndo: true,
  receiptNumber: 7,
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
  it('lists what they bought, an undone sale marked, and opens Sell with them already picked', async () => {
    svc.purchases.mockResolvedValue({ sales: [sale(), sale({ id: 's0', quantity: 1, totalMinor: 215, taxMinor: 16, undone: true })], notShown: 3 });
    open();
    const box = await screen.findByRole('region', { name: 'Bought at the desk' });
    expect(svc.purchases).toHaveBeenCalledWith('g1', 'e1');
    expect(within(box).getAllByTestId('purchase-row').map((r) => r.textContent)).toEqual(['2 × Water12 Oct 2026 · Cash · $0.33 tax$4.31View receipt', '1 × Water12 Oct 2026 · Cash · $0.16 tax · Undone$2.15View receipt']);
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
