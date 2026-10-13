// THE SELL PAGE, drawn (ROADMAP 18b-i; spec Part 3 §14.3). Only the network is mocked:
// what staff see is read off the real page.
//
// The worst thing the screen could do: send one sale twice, send a total the person was
// not shown, or offer a sale to somebody the server would refuse.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const svc = {
  get: vi.fn(),
  findPeople: vi.fn(),
  sell: vi.fn(),
  undoSale: vi.fn(),
  saveTax: vi.fn(),
  addProduct: vi.fn(),
  changeProduct: vi.fn(),
  archiveProduct: vi.fn(),
  restoreProduct: vi.fn(),
  purchases: vi.fn(),
};
const orgApi = { getMine: vi.fn(), getMemberList: vi.fn(), getMembershipTypes: vi.fn(), giveHeldMembership: vi.fn() };
vi.mock('../../api/registerApi', () => ({ registerService: svc }));
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

const Sell = (await import('./Sell')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'members.confirm', 'billing.members', 'memberships.manage', 'org.manage'],
  timezone: 'America/Chicago',
  clockFormat: '12h',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const SELLER = { ...ORG, staffRole: 'trainer', privileges: ['members.read', 'billing.members'] };
const PRICER = { ...ORG, staffRole: 'trainer', privileges: ['members.read', 'memberships.manage'] };
const TRAINER = { ...ORG, staffRole: 'trainer', privileges: ['members.read', 'members.confirm'] };

const product = (over = {}) => ({ id: 'p-water', name: 'Water', priceMinor: 199, currency: 'USD', taxed: true, stock: 8, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z', ...over });
const TOWEL = product({ id: 'p-towel', name: 'Towel', priceMinor: 500, stock: null });
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
  person: null,
  undone: false,
  canUndo: true,
  ...over,
});
const totals = (over = {}) => ({ count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 0, ...over });
const page = (over = {}) => ({
  currency: 'USD',
  today: '2026-10-12',
  tax: { bp: 825, included: false },
  products: [TOWEL, product()],
  archived: [],
  archivedTotal: 0,
  canSell: true,
  canManage: true,
  sales: [],
  salesNotShown: 0,
  payments: [],
  paymentsNotShown: 0,
  totals: totals(),
  ...over,
});
const withSale = (s = sale()) => page({ sales: [s], totals: totals({ count: 1, totalMinor: s.totalMinor, taxMinor: s.taxMinor, cash: s.totalMinor }) });
const MAYA = { entryId: 'e-maya', name: 'Maya Patel', email: null, memberNumber: '1042', past: false };
const PAST = { entryId: 'e-omar', name: 'Omar Diaz', email: null, memberNumber: null, past: true };
const MONTH = { id: 't-month', name: '1 Month', kind: 'one_time', priceMinor: 4999, currency: 'USD', termCount: 1, termUnit: 'month', packClasses: null, packDays: null };
const refusal = (status, message) => Object.assign(new Error(message), { response: { status, data: { message } } });

const open = (org = ORG, state = undefined) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={[{ pathname: '/console/iron-house/sell', state }]}>
      <Routes>
        <Route path="/console/:orgSlug/sell" element={<Sell />} />
        <Route path="/console/:orgSlug/members" element={<p>The Members page</p>} />
        <Route path="/console/:orgSlug/memberships" element={<p>The Memberships page</p>} />
        <Route path="/console/:orgSlug/settings" element={<p>The Settings page</p>} />
      </Routes>
    </MemoryRouter>,
  );
};
const newSale = () => screen.getByRole('region', { name: 'New sale' });
const today = () => screen.getByRole('region', { name: "Today's takings" });
const products = () => screen.getByRole('region', { name: 'Products' });
const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const takeButton = () => within(newSale()).getByRole('button', { name: /^Take payment/ });

beforeEach(() => {
  resetConsoleOrgs();
  svc.get.mockResolvedValue(page());
  svc.findPeople.mockResolvedValue([MAYA]);
  svc.sell.mockResolvedValue({ saleId: 's1', register: withSale() });
  orgApi.getMemberList.mockResolvedValue({ data: { list: null } });
  orgApi.getMembershipTypes.mockResolvedValue({ data: { types: [MONTH] } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('a product sale', () => {
  it('shows the price, the tax and the total before the press, and sends exactly that total once', async () => {
    open();
    await screen.findByRole('region', { name: 'New sale' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sell');
    expect(svc.get).toHaveBeenCalledWith('g1');
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).queryByTestId('sale-summary')).toBeNull();
    expect(Array.from(screen.getByLabelText('Product').options).map((o) => o.textContent)).toEqual(['Pick a product', 'Towel · $5.00', 'Water · $1.99 · 8 left']);

    pick('Product', 'p-water');
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '2' } });
    pick('How did they pay?', 'card_at_desk');
    expect(within(newSale()).getByTestId('sale-summary').textContent).toBe('Price$3.98Tax (8.25%)$0.33Total$4.31');
    expect(takeButton().textContent).toBe('Take payment · $4.31');
    expect(within(newSale()).getByText('This records the sale. Take the money yourself: the app does not charge anybody.')).toBeTruthy();

    let finish;
    svc.sell.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    fireEvent.click(takeButton());
    // Pressed again while it is being recorded: nothing more is sent.
    fireEvent.click(within(newSale()).getByRole('button', { name: 'Recording…' }));
    expect(svc.sell).toHaveBeenCalledTimes(1);
    const [gymId, body] = svc.sell.mock.calls[0];
    expect(gymId).toBe('g1');
    expect(body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), productId: 'p-water', quantity: 2, entryId: null, method: 'card_at_desk', totalMinor: 431 });
    finish({ saleId: 's1', register: withSale(sale({ method: 'card_at_desk' })) });

    const done = await within(newSale()).findByTestId('sale-done');
    expect(done.textContent).toBe("Sale recordedSold: 2 × Water to a walk-in. $4.31, card at the desk.It is in today's list below. To take it back, press Undo sale on its row.New sale");
    // The form is gone: there is nothing to press a second time by mistake.
    expect(within(newSale()).queryByRole('button', { name: /^Take payment/ })).toBeNull();
    expect(screen.queryByLabelText('Product')).toBeNull();
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Taken today: $4.31 from 1 sale. Cash $4.31.');
    expect(within(today()).getAllByTestId('takings-row').map((r) => r.textContent)).toEqual([expect.stringContaining('2 × Water · $4.31')]);
    // New sale brings back an empty form: no product picked, so nothing can be sold yet.
    fireEvent.click(within(newSale()).getByRole('button', { name: 'New sale' }));
    expect(within(newSale()).queryByTestId('sale-done')).toBeNull();
    expect(screen.getByLabelText('Product').value).toBe('');
    expect(screen.getByLabelText('How many').value).toBe('1');
    expect(takeButton().disabled).toBe(true);
    fireEvent.click(takeButton());
    expect(svc.sell).toHaveBeenCalledTimes(1);
    // The next sale has a key of its own.
    pick('Product', 'p-water');
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(2));
    expect(svc.sell.mock.calls[1][1].requestKey).not.toBe(body.requestKey);
    expect(svc.sell.mock.calls[1][1]).toMatchObject({ quantity: 1, totalMinor: 215 });
  });

  it('is for a walk-in until a member is found and picked, and then names them', async () => {
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-towel');
    expect(screen.getByLabelText('Walk-in (not on your list)').checked).toBe(true);
    fireEvent.click(screen.getByLabelText('A member'));
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).getByText('Find and pick the member, or choose Walk-in.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find them by name or member number'), { target: { value: 'm' } });
    fireEvent.change(screen.getByLabelText('Find them by name or member number'), { target: { value: 'may' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    expect(svc.findPeople).toHaveBeenCalledTimes(1);
    expect(svc.findPeople).toHaveBeenCalledWith('g1', 'may');
    expect(within(newSale()).getByTestId('sell-person').textContent).toBe('Maya Patel · No. 1042');
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(1));
    expect(svc.sell.mock.calls[0][1]).toMatchObject({ productId: 'p-towel', entryId: 'e-maya', totalMinor: 541 });
  });

  it('nobody found says what to do, with a button to add a member that asks before leaving', async () => {
    svc.findPeople.mockResolvedValue([]);
    open();
    await screen.findByRole('region', { name: 'New sale' });
    fireEvent.click(screen.getByLabelText('A member'));
    fireEvent.change(screen.getByLabelText('Find them by name or member number'), { target: { value: 'zed' } });
    expect(await within(newSale()).findByText('Nobody on your list matches. Add them to your list first, or choose Walk-in.')).toBeTruthy();
    fireEvent.click(within(newSale()).getByRole('button', { name: 'Add a member' }));
    expect(within(newSale()).getByText(/You'll leave this page/)).toBeTruthy();
    expect(screen.queryByText('The Members page')).toBeNull();
  });

  it('comes from a person’s page with them already picked', async () => {
    open(ORG, { sellTo: { entryId: 'e-maya', name: 'Maya Patel', past: false } });
    await screen.findByRole('region', { name: 'New sale' });
    expect(screen.getByLabelText('A member').checked).toBe(true);
    expect(within(newSale()).getByTestId('sell-person').textContent).toBe('Maya Patel');
  });

  it('a refusal is said under the button, nothing is counted, and the page is read again', async () => {
    svc.sell.mockRejectedValue(refusal(409, 'The price or the tax changed while this was open. Nothing was sold: check the total and press again.'));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-water');
    svc.get.mockResolvedValue(page({ tax: { bp: 0, included: false } }));
    fireEvent.click(takeButton());
    expect((await within(newSale()).findByRole('alert')).textContent).toBe('The price or the tax changed while this was open. Nothing was sold: check the total and press again.');
    expect(within(newSale()).queryByTestId('sale-done')).toBeNull();
    await waitFor(() => expect(takeButton().textContent).toBe('Take payment · $1.99'));
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Nothing taken yet today.');
  });

  it('what is out of stock, or more than is left, cannot be pressed and says why', async () => {
    svc.get.mockResolvedValue(page({ products: [product({ stock: 0 }), product({ id: 'p-bar', name: 'Bar', stock: 2 })] }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-water');
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).getByText('Water is out of stock. Change its stock count under Products if you have more.')).toBeTruthy();
    pick('Product', 'p-bar');
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '3' } });
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).getByText('Only 2 left in stock.')).toBeTruthy();
    expect(svc.sell).not.toHaveBeenCalled();
  });
});

describe('today', () => {
  it('is read again when the tab is looked at again: a page left open overnight does not go on saying yesterday', async () => {
    svc.get.mockResolvedValue(withSale());
    open();
    await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row');
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Taken today: $4.31 from 1 sale. Cash $4.31.');
    expect(svc.get).toHaveBeenCalledTimes(1);
    // The next morning: the server's day has moved on, and nothing was taken yet.
    svc.get.mockResolvedValue(page({ today: '2026-10-13' }));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(within(today()).getByTestId('takings-line').textContent).toBe('Nothing taken yet today.'));
    expect(within(today()).queryAllByTestId('takings-row')).toHaveLength(0);
    expect(svc.get).toHaveBeenCalledTimes(2);
  });

  it('what was taken in another currency is said and never added to the total', async () => {
    svc.get.mockResolvedValue(page({ currency: 'GBP', sales: [sale()], products: [product({ currency: 'USD' })], totals: totals({ otherCurrency: 1 }) }));
    open();
    await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row');
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Nothing taken yet today.');
    expect(within(today()).getByText('1 sale or payment today was taken in another currency, before your country was changed. It is listed below and not added to the total above.')).toBeTruthy();
    // The product still priced in the old money cannot be sold, and its row says what to do.
    pick('Product', 'p-water');
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).getByText('Water is priced in USD, and you now sell in GBP. Open Water under Products and save its price in GBP.')).toBeTruthy();
    expect(within(products()).getByTestId('product-row').textContent).toContain('priced in USD: save its price in GBP to sell it');
    expect(svc.sell).not.toHaveBeenCalled();
  });

  it('a sale is undone only after the box is answered, and Keep it sends nothing', async () => {
    svc.get.mockResolvedValue(withSale(sale({ person: { entryId: 'e-maya', name: 'Maya Patel' } })));
    svc.undoSale.mockResolvedValue(page({ sales: [sale({ undone: true, canUndo: false })] }));
    open();
    const row = (await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row'))[0];
    expect(row.textContent).toContain('Maya Patel · Cash · 9:05 AM · by Sam Desk');
    fireEvent.click(within(row).getByRole('button', { name: 'Undo sale of 2 × Water' }));
    expect(within(row).getByText("Undo this sale? 2 × Water, $4.31. It will no longer count in today's total. If you took the money, give it back yourself.")).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Keep it' }));
    expect(svc.undoSale).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Undo sale of 2 × Water' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Undo sale' }));
    await waitFor(() => expect(svc.undoSale).toHaveBeenCalledWith('g1', 's1'));
    expect(await within(today()).findByText("Sale undone: 2 × Water. It no longer counts in today's total.")).toBeTruthy();
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Nothing taken yet today.');
    const after = within(today()).getAllByTestId('takings-row')[0];
    expect(after.textContent).toContain('Undone');
    expect(within(after).queryByRole('button', { name: /Undo sale/ })).toBeNull();
  });

  it('a long day shows its newest ten rows, with one button for the rest; the total counts every one', async () => {
    const many = Array.from({ length: 23 }, (_, n) => sale({ id: `s${String(n)}`, quantity: 1, totalMinor: 215, taxMinor: 16, soldAt: `2026-10-12T14:${String(59 - n).padStart(2, '0')}:00.000Z` }));
    svc.get.mockResolvedValue(page({ sales: many, totals: totals({ count: 23, totalMinor: 23 * 215, taxMinor: 23 * 16, cash: 23 * 215 }) }));
    open();
    await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row');
    expect(within(today()).getAllByTestId('takings-row')).toHaveLength(10);
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Taken today: $49.45 from 23 sales. Cash $49.45.');
    fireEvent.click(within(today()).getByRole('button', { name: 'Show all 23' }));
    expect(within(today()).getAllByTestId('takings-row')).toHaveLength(23);
    fireEvent.click(within(today()).getByRole('button', { name: 'Show only the newest 10' }));
    expect(within(today()).getAllByTestId('takings-row')).toHaveLength(10);
  });

  it('a membership payment is in the list with no Undo, and says where it is undone; a name opens their page', async () => {
    const payment = { id: 'm1', typeName: '1 Month', amountMinor: 4999, currency: 'USD', method: 'card_at_desk', paidAt: '2026-10-12T15:30:00.000Z', by: 'Sam Desk', person: { entryId: 'e-maya', name: 'Maya Patel' } };
    svc.get.mockResolvedValue(page({ payments: [payment], totals: totals({ payments: 1, totalMinor: 4999, card_at_desk: 4999 }) }));
    open();
    const row = (await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row'))[0];
    expect(row.textContent).toContain('1 Month (membership) · $49.99');
    expect(within(row).queryByRole('button', { name: /Undo/ })).toBeNull();
    expect(within(today()).getByText("To undo or refund a membership payment, open the member's page.")).toBeTruthy();
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Taken today: $49.99 from 1 membership payment. Card at the desk $49.99.');
    fireEvent.click(within(row).getByRole('button', { name: "Open Maya Patel's page" }));
    expect(screen.getByRole('dialog', { name: 'person e-maya' })).toBeTruthy();
  });
});

describe('a membership', () => {
  it('needs a person, is given as paid from today, and says so with a button to their page', async () => {
    orgApi.giveHeldMembership.mockResolvedValue({ data: {} });
    open();
    await screen.findByRole('region', { name: 'New sale' });
    fireEvent.click(within(newSale()).getByRole('button', { name: 'A membership' }));
    await screen.findByLabelText('Membership');
    pick('Membership', 't-month');
    expect(screen.queryByLabelText('Walk-in (not on your list)')).toBeNull();
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).getByText('Find and pick the member it is for.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find them by name or member number'), { target: { value: 'maya' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    pick('How did they pay?', 'bank_transfer');
    expect(takeButton().textContent).toBe('Take payment · $49.99');
    fireEvent.click(takeButton());
    await waitFor(() => expect(orgApi.giveHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgApi.giveHeldMembership).toHaveBeenCalledWith('g1', 'e-maya', { requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), typeId: 't-month', startsOn: '2026-10-12', paid: true, priceMinor: 4999, method: 'bank_transfer' });
    const done = await within(newSale()).findByTestId('sale-done');
    expect(done.textContent).toContain('Sale recorded');
    expect(done.textContent).toContain('1 Month given to Maya Patel and recorded as paid. $49.99, bank transfer.');
    expect(done.textContent).toContain("To undo or refund it, open the member's page.");
    expect(within(newSale()).queryByRole('button', { name: /^Take payment/ })).toBeNull();
    // The day is read before the give and the takings after it, so the payment is in today's list.
    await waitFor(() => expect(svc.get).toHaveBeenCalledTimes(3));
    fireEvent.click(within(done).getByRole('button', { name: "Open Maya Patel's page" }));
    expect(screen.getByRole('dialog', { name: 'person e-maya' })).toBeTruthy();
  });

  it('a tab left open overnight starts the membership on the day the server says it is now, never the day the page was opened', async () => {
    orgApi.giveHeldMembership.mockResolvedValue({ data: {} });
    open();
    await screen.findByRole('region', { name: 'New sale' });
    fireEvent.click(within(newSale()).getByRole('button', { name: 'A membership' }));
    await screen.findByLabelText('Membership');
    pick('Membership', 't-month');
    fireEvent.change(screen.getByLabelText('Find them by name or member number'), { target: { value: 'maya' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    // Midnight passes at the gym while the form is open.
    svc.get.mockResolvedValue(page({ today: '2026-10-13' }));
    fireEvent.click(takeButton());
    await waitFor(() => expect(orgApi.giveHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgApi.giveHeldMembership.mock.calls[0][2]).toMatchObject({ startsOn: '2026-10-13', priceMinor: 4999 });
  });

  it('a price that changed while the form was open is refused in words, and the price list is read again', async () => {
    orgApi.giveHeldMembership.mockRejectedValue(refusal(409, 'The price of this membership changed while this was open. Nothing was saved: check the total and press again.'));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    fireEvent.click(within(newSale()).getByRole('button', { name: 'A membership' }));
    await screen.findByLabelText('Membership');
    pick('Membership', 't-month');
    fireEvent.change(screen.getByLabelText('Find them by name or member number'), { target: { value: 'maya' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    expect(takeButton().textContent).toBe('Take payment · $49.99');
    orgApi.getMembershipTypes.mockResolvedValue({ data: { types: [{ ...MONTH, priceMinor: 5999 }] } });
    fireEvent.click(takeButton());
    expect((await within(newSale()).findByRole('alert')).textContent).toBe('The price of this membership changed while this was open. Nothing was saved: check the total and press again.');
    expect(within(newSale()).queryByTestId('sale-done')).toBeNull();
    // The button now says the price as it is, and the next press sends that one.
    await waitFor(() => expect(takeButton().textContent).toBe('Take payment · $59.99'));
    expect(orgApi.getMembershipTypes).toHaveBeenCalledTimes(2);
    orgApi.giveHeldMembership.mockResolvedValue({ data: {} });
    fireEvent.click(takeButton());
    await waitFor(() => expect(orgApi.giveHeldMembership).toHaveBeenCalledTimes(2));
    expect(orgApi.giveHeldMembership.mock.calls[1][2]).toMatchObject({ priceMinor: 5999 });
    expect(orgApi.giveHeldMembership.mock.calls[1][2].requestKey).not.toBe(orgApi.giveHeldMembership.mock.calls[0][2].requestKey);
  });

  it('a past member is not given one here: the screen says why and opens their page', async () => {
    svc.findPeople.mockResolvedValue([PAST]);
    open();
    await screen.findByRole('region', { name: 'New sale' });
    fireEvent.click(within(newSale()).getByRole('button', { name: 'A membership' }));
    await screen.findByLabelText('Membership');
    pick('Membership', 't-month');
    fireEvent.change(screen.getByLabelText('Find them by name or member number'), { target: { value: 'omar' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Omar Diaz · Past member' }));
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).getByText('Omar Diaz is a past member. Put them back on your list from their page, then give the membership.')).toBeTruthy();
    fireEvent.click(within(newSale()).getByRole('button', { name: "Open Omar Diaz's page" }));
    expect(screen.getByRole('dialog', { name: 'person e-omar' })).toBeTruthy();
    expect(orgApi.giveHeldMembership).not.toHaveBeenCalled();
  });

  it('with no membership types the box says so and opens Memberships', async () => {
    orgApi.getMembershipTypes.mockResolvedValue({ data: { types: [] } });
    open();
    await screen.findByRole('region', { name: 'New sale' });
    fireEvent.click(within(newSale()).getByRole('button', { name: 'A membership' }));
    expect(await within(newSale()).findByText(/You have no membership types yet\./)).toBeTruthy();
    fireEvent.click(within(newSale()).getByRole('link', { name: 'Open Memberships' }));
    expect(screen.getByText('The Memberships page')).toBeTruthy();
  });
});

describe('products and tax', () => {
  it('a gym with no products is offered the form from the sale box, and the form says what is wrong before it is sent', async () => {
    svc.get.mockResolvedValue(page({ products: [], tax: { bp: 0, included: false } }));
    svc.addProduct.mockResolvedValue(page({ products: [product({ stock: null })], tax: { bp: 0, included: false } }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    expect(within(newSale()).getByText('You have no products yet. Add what you sell at the desk, such as water or a towel, and it appears here.')).toBeTruthy();
    fireEvent.click(within(newSale()).getByRole('button', { name: 'Add your first product' }));
    const form = within(products()).getByRole('form', { name: 'Add a product' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add product' }));
    expect(within(form).getByText('Give the product a name.')).toBeTruthy();
    expect(within(form).getByText('Enter the price as a number above 0, like 9.99.')).toBeTruthy();
    expect(svc.addProduct).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText('Product name'), { target: { value: ' Water ' } });
    fireEvent.change(within(form).getByLabelText('Price in USD'), { target: { value: '1.99' } });
    fireEvent.click(within(form).getByLabelText('Count how many are in stock'));
    fireEvent.change(within(form).getByLabelText('How many you have now'), { target: { value: '24' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add product' }));
    await waitFor(() => expect(svc.addProduct).toHaveBeenCalledWith('g1', { name: 'Water', priceMinor: 199, taxed: true, stock: 24 }));
    expect(await within(products()).findByText('Water added. It is now on the Sell form above.')).toBeTruthy();
    expect(within(products()).queryByRole('form')).toBeNull();
    expect(screen.getByLabelText('Product')).toBeTruthy();
  });

  it('a product is changed with the time its form read it, and archived only after the box is answered', async () => {
    svc.changeProduct.mockResolvedValue(page());
    svc.archiveProduct.mockResolvedValue(page({ products: [TOWEL], archived: [product({ archivedAt: '2026-10-12T16:00:00.000Z' })], archivedTotal: 1 }));
    svc.restoreProduct.mockResolvedValue(page());
    open();
    await screen.findByRole('region', { name: 'Products' });
    const rows = within(products()).getAllByTestId('product-row');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Towel$5.00 · plus tax · stock not counted'), expect.stringContaining('Water$1.99 · plus tax · 8 in stock')]);
    fireEvent.click(within(products()).getByRole('button', { name: 'Change Water' }));
    const form = within(products()).getByRole('form', { name: 'Change product' });
    expect(within(form).getByLabelText('How many you have now').value).toBe('8');
    fireEvent.change(within(form).getByLabelText('How many you have now'), { target: { value: '20' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(svc.changeProduct).toHaveBeenCalledWith('g1', 'p-water', { name: 'Water', priceMinor: 199, taxed: true, stock: 20, updatedAt: '2026-10-12T10:00:00.000Z' }));

    fireEvent.click(await within(products()).findByRole('button', { name: 'Archive Water' }));
    expect(within(products()).getByText('Archive Water? It leaves the Sell form. Its past sales are kept, and you can put it back.')).toBeTruthy();
    fireEvent.click(within(products()).getByRole('button', { name: 'Keep it' }));
    expect(svc.archiveProduct).not.toHaveBeenCalled();
    fireEvent.click(within(products()).getByRole('button', { name: 'Archive Water' }));
    fireEvent.click(within(products()).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(svc.archiveProduct).toHaveBeenCalledWith('g1', 'p-water'));
    fireEvent.click(await within(products()).findByRole('button', { name: 'Show archived products (1)' }));
    fireEvent.click(within(products()).getByRole('button', { name: 'Put Water back' }));
    await waitFor(() => expect(svc.restoreProduct).toHaveBeenCalledWith('g1', 'p-water'));
  });

  it('a save the server refuses is said in the form, and the list is read again', async () => {
    svc.changeProduct.mockRejectedValue(refusal(409, 'This product changed while you had it open, or one was sold. Nothing was saved: check it and try again.'));
    open();
    await screen.findByRole('region', { name: 'Products' });
    fireEvent.click(within(products()).getByRole('button', { name: 'Change Water' }));
    fireEvent.click(within(products()).getByRole('button', { name: 'Save product' }));
    expect((await within(products()).findByRole('alert')).textContent).toBe('This product changed while you had it open, or one was sold. Nothing was saved: check it and try again.');
    await waitFor(() => expect(svc.get).toHaveBeenCalledTimes(2));
  });

  it('the tax is saved as a rate and a way, says what is wrong with a rate, and says it is saved', async () => {
    svc.saveTax.mockResolvedValue(page({ tax: { bp: 2000, included: true } }));
    open();
    await screen.findByRole('region', { name: 'Products' });
    expect(within(products()).getByText('8.25% tax is added on top of the price of each taxed product.')).toBeTruthy();
    const save = within(products()).getByRole('button', { name: 'Save tax' });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Tax rate, in percent'), { target: { value: '8,25' } });
    fireEvent.click(save);
    expect(within(products()).getByRole('alert').textContent).toBe('Enter the tax rate as a number from 0 to 30, like 8.25. Use 0 for no tax.');
    expect(svc.saveTax).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Tax rate, in percent'), { target: { value: '20' } });
    fireEvent.click(screen.getByLabelText(/Already included in the price/));
    expect(within(products()).getByText('Not saved yet.')).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(svc.saveTax).toHaveBeenCalledWith('g1', { bp: 2000, included: true }));
    expect(await within(products()).findByText('Saved. New sales use this tax; sales already made keep theirs.')).toBeTruthy();
    expect(within(products()).getByText('Your prices include 20% tax. Each sale shows how much of it is tax.')).toBeTruthy();
  });

  it('a gym with no country is sent to set it, and has no Add button', async () => {
    svc.get.mockResolvedValue(page({ currency: null, products: [] }));
    open();
    await screen.findByRole('region', { name: 'Products' });
    expect(within(products()).getByText('Set your country before adding a product. It decides the money your prices are in.')).toBeTruthy();
    expect(within(products()).queryByRole('button', { name: 'Add a product' })).toBeNull();
    fireEvent.click(within(products()).getByRole('link', { name: 'Set your country' }));
    expect(screen.getByText('The Settings page')).toBeTruthy();
  });
});

describe('who sees what', () => {
  it('staff who only record payments sell, and read the products with no button to change them', async () => {
    svc.get.mockResolvedValue(page({ canManage: false, products: [] }));
    open(SELLER);
    await screen.findByRole('region', { name: 'New sale' });
    expect(within(newSale()).getByText('The owner, or staff who can change membership types and prices, can add products.')).toBeTruthy();
    expect(within(newSale()).queryByRole('button', { name: 'Add your first product' })).toBeNull();
    // No tick for the person's page: no membership from here.
    expect(within(newSale()).queryByRole('button', { name: 'A membership' })).toBeNull();
    expect(within(products()).getByText('The owner, or staff who can change membership types and prices, can add and change products and tax.')).toBeTruthy();
    expect(within(products()).queryByRole('button', { name: 'Add a product' })).toBeNull();
    expect(screen.queryByLabelText('Tax rate, in percent')).toBeNull();
    expect(within(products()).getByText('8.25% tax is added on top of the price of each taxed product.')).toBeTruthy();
  });

  it('staff who only change prices have the products and the tax, and are told who can sell', async () => {
    svc.get.mockResolvedValue(page({ canSell: false, payments: null }));
    open(PRICER);
    await screen.findByRole('region', { name: 'Products' });
    expect(screen.queryByRole('region', { name: 'New sale' })).toBeNull();
    expect(screen.queryByRole('region', { name: "Today's takings" })).toBeNull();
    expect(screen.getByText('You can change products and tax here, but you can\'t record a sale. Ask the owner to turn on "Record members\' payments" for you.')).toBeTruthy();
    expect(within(products()).getByRole('button', { name: 'Add a product' })).toBeTruthy();
  });

  it('staff with neither tick are told, and nothing is asked for them', async () => {
    open(TRAINER);
    expect(await screen.findByText("Your role doesn't allow you to sell or to change products. Ask the owner if you need to.")).toBeTruthy();
    expect(svc.get).not.toHaveBeenCalled();
    expect(orgApi.getMembershipTypes).not.toHaveBeenCalled();
  });

  it('a gym that needs a plan reads the page and can press nothing', async () => {
    svc.get.mockResolvedValue(withSale());
    open({ ...ORG, consoleReadOnly: true });
    await screen.findByRole('region', { name: 'New sale' });
    expect(screen.getAllByText('This gym needs a plan before anything here can be changed.').length).toBeGreaterThan(0);
    pick('Product', 'p-towel');
    expect(screen.getByLabelText('Product').disabled).toBe(true);
    expect(takeButton().disabled).toBe(true);
    expect(within(today()).getByRole('button', { name: 'Undo sale of 2 × Water' }).disabled).toBe(true);
    expect(within(products()).getByRole('button', { name: 'Add a product' }).disabled).toBe(true);
    expect(within(products()).getByRole('button', { name: 'Change Water' }).disabled).toBe(true);
    expect(within(products()).getByRole('button', { name: 'Save tax' }).disabled).toBe(true);
  });
});
