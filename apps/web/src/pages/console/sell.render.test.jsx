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
  voidSale: vi.fn(),
  refundSale: vi.fn(),
  voidSaleRefund: vi.fn(),
  saveTaxMode: vi.fn(),
  addTaxRate: vi.fn(),
  changeTaxRate: vi.fn(),
  removeTaxRate: vi.fn(),
  chargeTaxRate: vi.fn(),
  addProduct: vi.fn(),
  changeProduct: vi.fn(),
  archiveProduct: vi.fn(),
  restoreProduct: vi.fn(),
  purchases: vi.fn(),
  receipt: vi.fn(),
  friendGift: vi.fn(),
};
const orgApi = { getMine: vi.fn(), getMemberList: vi.fn(), getMembershipTypes: vi.fn(), giveHeldMembership: vi.fn() };
vi.mock('../../api/registerApi', () => ({ registerService: svc }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, addMembership, onClose }) => (
    <div role="dialog" aria-label={`person ${entryId}`} data-add-membership={addMembership ? 'yes' : 'no'}>
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

const RATE = { id: 'r1', name: 'Sales tax', bp: 825, products: 2, membershipTypes: 0, memberships: 0 };
const NO_TAX = { included: false, rates: [] };
const product = (over = {}) => ({ id: 'p-water', name: 'Water', priceMinor: 199, currency: 'USD', taxRateId: 'r1', stock: 8, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z', ...over });
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
  taxName: 'Sales tax',
  taxIncluded: false,
  discountName: null,
  discountMinor: 0,
  currency: 'USD',
  method: 'cash',
  soldOn: '2026-10-12',
  soldAt: '2026-10-12T14:05:00.000Z',
  by: 'Sam Desk',
  person: null,
  undone: false,
  voided: null,
  canUndo: true,
  receiptNumber: 41,
  ...over,
});
const totals = (over = {}) => ({ count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, discountMinor: 0, otherCurrency: 0, ...over });
const page = (over = {}) => ({
  currency: 'USD',
  today: '2026-10-12',
  tax: { included: false, rates: [RATE] },
  products: [TOWEL, product()],
  archived: [],
  archivedTotal: 0,
  discounts: [],
  archivedDiscounts: [],
  archivedDiscountsTotal: 0,
  membershipTypes: [],
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
const taxBox = () => screen.getByRole('region', { name: 'Tax' });
const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const takeButton = () => within(newSale()).getByRole('button', { name: /^Take payment/ });
/** A sale's ⋯, then Void sale in its list. */
const openVoid = (row) => {
  fireEvent.click(within(row).getByRole('button', { name: 'More for the sale of 2 × Water' }));
  fireEvent.click(within(row).getByRole('menuitem', { name: /^Void sale/ }));
};

beforeEach(() => {
  resetConsoleOrgs();
  svc.get.mockResolvedValue(page());
  svc.findPeople.mockResolvedValue([MAYA]);
  svc.friendGift.mockResolvedValue({ friendGift: null });
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
    expect(within(newSale()).getByTestId('sale-summary').textContent).toBe('Price$3.98Sales tax 8.25%$0.33Total$4.31');
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
    expect(body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), productId: 'p-water', quantity: 2, entryId: null, method: 'card_at_desk', totalMinor: 431, discountId: null });
    finish({ saleId: 's1', register: withSale(sale({ method: 'card_at_desk' })) });

    const done = await within(newSale()).findByTestId('sale-done');
    expect(done.textContent).toBe("Sale recordedSold: 2 × Water to a walk-in. $4.31, card at the desk.It is in today's list below. If it was a mistake, press ⋯ on its row, then Void sale.New saleView receipt");
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
    fireEvent.change(within(newSale()).getByLabelText('Find them by name or member number'), { target: { value: 'm' } });
    fireEvent.change(within(newSale()).getByLabelText('Find them by name or member number'), { target: { value: 'may' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    expect(svc.findPeople).toHaveBeenCalledTimes(1);
    expect(svc.findPeople).toHaveBeenCalledWith('g1', 'may');
    expect(within(newSale()).getByTestId('sell-person').textContent).toBe('Maya Patel · No. 1042');
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(1));
    expect(svc.sell.mock.calls[0][1]).toMatchObject({ productId: 'p-towel', entryId: 'e-maya', totalMinor: 541 });
  });

  it("Refer a friend's gift is filled in for the friend picked, never for a walk-in or anybody else, and Remove takes it off (20e-ii-b-i)", async () => {
    const gift = {
      id: 'd-friend', name: "Refer a friend: friend's gift, WELCOME10", code: 'WELCOME10', kind: 'percent', percentBp: 1000, amountMinor: null, currency: null,
      startsOn: null, endsOn: null, maxUses: null, uses: 0, forProducts: true, allProducts: true, productIds: [], forMemberships: false, allMembershipTypes: true,
      membershipTypeIds: [], membershipPayments: null, referralGift: true, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z',
    };
    // The gym's own list holds it, for the Discounts box; the sale offers it to its friend alone.
    svc.get.mockResolvedValue(page({ discounts: [gift] }));
    svc.friendGift.mockImplementation((_gym, entryId) => Promise.resolve({ friendGift: entryId === 'e-maya' ? { discount: gift, words: '10% off products', invitedBy: 'Ravi Kumar' } : null }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-towel');
    expect(within(newSale()).queryByTestId('friend-gift')).toBeNull();
    expect(within(newSale()).queryByRole('option', { name: /WELCOME10/ })).toBeNull();

    fireEvent.click(screen.getByLabelText('A member'));
    fireEvent.change(within(newSale()).getByLabelText('Find them by name or member number'), { target: { value: 'may' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    const note = within(await within(newSale()).findByTestId('friend-gift'));
    expect(note.getByText("Friend's gift filled in")).toBeTruthy();
    expect(note.getByText('10% off products. Refer a friend: Ravi Kumar invited them.')).toBeTruthy();
    fireEvent.click(note.getByRole('button', { name: 'Remove' }));
    expect(note.getByText("Friend's gift removed")).toBeTruthy();
    fireEvent.click(note.getByRole('button', { name: 'Put it back' }));
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(1));
    expect(svc.sell.mock.calls[0][1]).toMatchObject({ productId: 'p-towel', entryId: 'e-maya', discountId: 'd-friend' });
  });

  it("a member's own Refer a friend gift is filled in for them at Sell, in a discount's place, and Remove keeps it (20e-ii-b-ii-a)", async () => {
    const memberGift = { id: 'g-maya', kind: 'percent', percentBp: 1000, amountMinor: null, currency: null, words: '10% off', friendName: 'Tara Shah' };
    svc.friendGift.mockImplementation((_gym, entryId) => Promise.resolve({ friendGift: null, memberGift: entryId === 'e-maya' ? memberGift : null }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-towel');
    expect(within(newSale()).queryByTestId('member-gift')).toBeNull();
    fireEvent.click(screen.getByLabelText('A member'));
    fireEvent.change(within(newSale()).getByLabelText('Find them by name or member number'), { target: { value: 'may' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    const note = within(await within(newSale()).findByTestId('member-gift'));
    expect(note.getByText('Refer a friend gift filled in')).toBeTruthy();
    expect(note.getByText('10% off. Refer a friend: for inviting Tara Shah, who joined.')).toBeTruthy();
    expect(within(newSale()).getByText('Discount (Refer a friend gift)')).toBeTruthy();
    fireEvent.click(note.getByRole('button', { name: 'Remove' }));
    expect(note.getByText('Refer a friend gift removed')).toBeTruthy();
    expect(within(newSale()).queryByText('Discount (Refer a friend gift)')).toBeNull();
    fireEvent.click(note.getByRole('button', { name: 'Put it back' }));
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(1));
    const sent = svc.sell.mock.calls[0][1];
    expect(sent).toMatchObject({ productId: 'p-towel', entryId: 'e-maya', discountId: null, memberGift: { id: 'g-maya' } });
    expect(sent.memberGift.offMinor).toBeGreaterThan(0);
  });

  it("Refer a friend's gift never replaces a discount staff picked before it was found", async () => {
    const gift = {
      id: 'd-friend', name: "Refer a friend: friend's gift, WELCOME10", code: 'WELCOME10', kind: 'percent', percentBp: 1000, amountMinor: null, currency: null,
      startsOn: null, endsOn: null, maxUses: null, uses: 0, forProducts: true, allProducts: true, productIds: [], forMemberships: false, allMembershipTypes: true,
      membershipTypeIds: [], membershipPayments: null, referralGift: true, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z',
    };
    const summer = { ...gift, id: 'd-summer', name: 'Summer', code: null, referralGift: false, percentBp: 500 };
    svc.get.mockResolvedValue(page({ discounts: [gift, summer] }));
    let answer;
    svc.friendGift.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-towel');
    fireEvent.click(screen.getByLabelText('A member'));
    fireEvent.change(within(newSale()).getByLabelText('Find them by name or member number'), { target: { value: 'may' } });
    fireEvent.click(await within(newSale()).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    pick('Discount', 'd-summer');
    answer({ friendGift: { discount: gift, words: '10% off products', invitedBy: 'Ravi Kumar' } });
    const note = within(await within(newSale()).findByTestId('friend-gift'));
    expect(note.getByRole('button', { name: 'Put it back' })).toBeTruthy();
    expect(screen.getByLabelText('Discount').value).toBe('d-summer');
  });

  it('nobody found says what to do, with a button to add a member that asks before leaving', async () => {
    svc.findPeople.mockResolvedValue([]);
    open();
    await screen.findByRole('region', { name: 'New sale' });
    fireEvent.click(screen.getByLabelText('A member'));
    fireEvent.change(within(newSale()).getByLabelText('Find them by name or member number'), { target: { value: 'zed' } });
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
    svc.get.mockResolvedValue(page({ tax: NO_TAX }));
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
    expect(within(today()).getByText('1 sale or payment today was taken in another currency. It is listed below and not added to the total above.')).toBeTruthy();
    // The product still priced in the old money cannot be sold, and its row says what to do.
    pick('Product', 'p-water');
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).getByText('Water is priced in USD, and you now sell in GBP. Open Water under Products and save its price in GBP.')).toBeTruthy();
    expect(within(products()).getByTestId('product-row').textContent).toContain('priced in USD: save its price in GBP to sell it');
    expect(svc.sell).not.toHaveBeenCalled();
  });

  it('a sale is voided only after the box is answered with a reason, and Keep it sends nothing', async () => {
    svc.get.mockResolvedValue(withSale(sale({ person: { entryId: 'e-maya', name: 'Maya Patel' } })));
    svc.voidSale.mockResolvedValue(page({ sales: [sale({ undone: true, voided: { reason: 'returned', on: '2026-10-12', by: 'Sam Desk' }, canUndo: false })] }));
    open();
    const row = (await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row'))[0];
    expect(row.textContent).toContain('Maya Patel · Cash · 9:05 AM · by Sam Desk');
    openVoid(row);
    expect(
      within(row).getByText("Void this sale? 2 × Water, $4.31. It will no longer count in today's total, and it stays in the list crossed out. If you took the money, give it back yourself."),
    ).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Keep it' }));
    expect(svc.voidSale).not.toHaveBeenCalled();
    openVoid(row);
    // No reason picked: nothing is sent, and the box says what is missing.
    fireEvent.click(within(row).getByRole('button', { name: 'Void sale' }));
    expect(within(row).getByRole('alert').textContent).toBe('Pick why you are voiding it.');
    expect(svc.voidSale).not.toHaveBeenCalled();
    expect(within(within(row).getByLabelText('Why are you voiding it?')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose one',
      'Recorded by mistake',
      'Wrong product or quantity',
      'Brought back',
      'Something else',
    ]);
    fireEvent.change(within(row).getByLabelText('Why are you voiding it?'), { target: { value: 'returned' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Void sale' }));
    await waitFor(() => expect(svc.voidSale).toHaveBeenCalledWith('g1', 's1', { reason: 'returned' }));
    expect(await within(today()).findByText("Sale voided: 2 × Water. It no longer counts in today's total.")).toBeTruthy();
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Nothing taken yet today.');
    const after = within(today()).getAllByTestId('takings-row')[0];
    expect(after.textContent).toContain('Voided');
    expect(after.textContent).toContain('Voided 12 October 2026 by Sam Desk · Brought back');
    expect(within(after).queryByRole('button', { name: /Void sale/ })).toBeNull();
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

  it('a membership payment is in the list with no Void, and says where it is voided; a name opens their page', async () => {
    const payment = { id: 'm1', typeName: '1 Month', amountMinor: 4999, currency: 'USD', method: 'card_at_desk', paidAt: '2026-10-12T15:30:00.000Z', by: 'Sam Desk', person: { entryId: 'e-maya', name: 'Maya Patel' }, receiptNumber: 40 };
    svc.get.mockResolvedValue(page({ payments: [payment], totals: totals({ payments: 1, totalMinor: 4999, card_at_desk: 4999 }) }));
    open();
    const row = (await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row'))[0];
    expect(row.textContent).toContain('1 Month (membership) · $49.99');
    expect(within(row).queryByRole('button', { name: /Void/ })).toBeNull();
    expect(within(today()).getByText("To void or refund a membership payment, open the member's page.")).toBeTruthy();
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Taken today: $49.99 from 1 membership payment. Card at the desk $49.99.');
    fireEvent.click(within(row).getByRole('button', { name: "Open Maya Patel's page" }));
    expect(screen.getByRole('dialog', { name: 'person e-maya' })).toBeTruthy();
  });
});

describe('receipts (18g-i)', () => {
  const paper = (over = {}) => ({
    kind: 'sale',
    number: 41,
    gym: { name: 'Iron House', address: '12 High Street' },
    on: '2026-10-12',
    person: null,
    personDeleted: false,
    by: 'Sam Desk',
    currency: 'USD',
    cancelled: false,
    item: { name: 'Water', quantity: 2, unitPriceMinor: 199 },
    amounts: { listedMinor: 398, discount: null, tax: { name: 'Sales tax', bp: 825, included: false, minor: 33 }, totalMinor: 431 },
    method: 'card_at_desk',
    ...over,
  });

  it('the sale just recorded opens its own receipt under its box, by the number the server gave it', async () => {
    svc.receipt.mockResolvedValue(paper());
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-water');
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '2' } });
    pick('How did they pay?', 'card_at_desk');
    svc.sell.mockResolvedValue({ saleId: 's1', register: withSale(sale({ method: 'card_at_desk' })) });
    fireEvent.click(takeButton());
    const done = await within(newSale()).findByTestId('sale-done');
    fireEvent.click(within(done).getByRole('button', { name: 'View receipt #41 for this sale' }));
    const shown = await within(done).findByTestId('receipt');
    expect(svc.receipt).toHaveBeenCalledWith('g1', 41);
    expect(shown.textContent).toContain('Receipt #41');
    expect(shown.textContent).toContain('For: Walk-in');
    fireEvent.click(within(done).getByRole('button', { name: 'Close' }));
    expect(within(done).queryByTestId('receipt')).toBeNull();
  });

  it("each of today's rows opens its own receipt under that row, and only that one", async () => {
    const payment = { id: 'm1', typeName: '1 Month', amountMinor: 4999, currency: 'USD', method: 'cash', paidAt: '2026-10-12T15:30:00.000Z', by: 'Sam Desk', person: { entryId: 'e-maya', name: 'Maya Patel' }, receiptNumber: 40 };
    svc.get.mockResolvedValue(page({ sales: [sale()], payments: [payment], totals: totals({ count: 1, payments: 1, totalMinor: 5430, cash: 5430 }) }));
    svc.receipt.mockResolvedValue(paper({ kind: 'payment', number: 40, person: 'Maya Patel', item: { name: '1 Month', covers: { from: '2026-10-12', to: '2026-11-11' } }, amounts: { listedMinor: 4999, discount: null, tax: null, totalMinor: 4999 }, paidMinor: 4999, method: 'cash', balance: null, refunds: [] }));
    open();
    const rows = await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row');
    const paid = rows.find((r) => r.textContent.includes('1 Month'));
    const sold = rows.find((r) => r.textContent.includes('Water'));
    fireEvent.click(within(paid).getByRole('button', { name: 'View receipt #40 for 1 Month (membership)' }));
    expect(await within(paid).findByTestId('receipt')).toBeTruthy();
    expect(svc.receipt).toHaveBeenCalledWith('g1', 40);
    expect(within(sold).queryByTestId('receipt-box')).toBeNull();
  });
});

describe('a membership', () => {
  // Kd, 2026-10-14: Sell is for products; a membership is sold on the member's own page.
  it('is not sold here: the member is found, and their page opens with Add membership already open', async () => {
    open();
    await screen.findByRole('region', { name: 'New sale' });
    expect(within(newSale()).queryByRole('button', { name: 'A membership' })).toBeNull();
    expect(within(newSale()).getByLabelText('Product')).toBeTruthy();
    const box = screen.getByRole('region', { name: 'Sell a membership' });
    expect(within(box).getByText("Memberships are sold on the member's own page, where you pick the membership, a discount if there is one, and how they paid.")).toBeTruthy();
    fireEvent.change(within(box).getByLabelText('Find them by name or member number'), { target: { value: 'maya' } });
    fireEvent.click(await within(box).findByRole('button', { name: 'Maya Patel · No. 1042' }));
    fireEvent.click(within(box).getByRole('button', { name: 'Add a membership for Maya Patel' }));
    const page = screen.getByRole('dialog', { name: 'person e-maya' });
    expect(page.getAttribute('data-add-membership')).toBe('yes');
    expect(orgApi.giveHeldMembership).not.toHaveBeenCalled();
  });

  it('a name opened from today\'s list opens their page as it is, with nothing open', async () => {
    svc.get.mockResolvedValue(page({ payments: [{ id: 'm1', typeName: '1 Month', amountMinor: 4999, currency: 'USD', method: 'cash', paidAt: '2026-10-12T15:30:00.000Z', by: 'Sam Desk', person: { entryId: 'e-maya', name: 'Maya Patel' } }], totals: totals({ payments: 1, totalMinor: 4999, cash: 4999 }) }));
    open();
    fireEvent.click(await within(await screen.findByRole('region', { name: "Today's takings" })).findByRole('button', { name: "Open Maya Patel's page" }));
    expect(screen.getByRole('dialog', { name: 'person e-maya' }).getAttribute('data-add-membership')).toBe('no');
  });

  it('staff who cannot add memberships are not offered the box', async () => {
    open(SELLER);
    await screen.findByRole('region', { name: 'New sale' });
    expect(screen.queryByRole('region', { name: 'Sell a membership' })).toBeNull();
  });
});

describe('products and tax', () => {
  it('a gym with no products is offered the form from the sale box, and the form says what is wrong before it is sent', async () => {
    svc.get.mockResolvedValue(page({ products: [], tax: NO_TAX }));
    svc.addProduct.mockResolvedValue(page({ products: [product({ stock: null, taxRateId: null })], tax: NO_TAX }));
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
    await waitFor(() => expect(svc.addProduct).toHaveBeenCalledWith('g1', { name: 'Water', priceMinor: 199, taxRateId: null, stock: 24 }));
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
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Towel$5.00 · plus Sales tax 8.25% · stock not counted'), expect.stringContaining('Water$1.99 · plus Sales tax 8.25% · 8 in stock')]);
    fireEvent.click(within(products()).getByRole('button', { name: 'Change Water' }));
    const form = within(products()).getByRole('form', { name: 'Change product' });
    expect(within(form).getByLabelText('How many you have now').value).toBe('8');
    fireEvent.change(within(form).getByLabelText('How many you have now'), { target: { value: '20' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(svc.changeProduct).toHaveBeenCalledWith('g1', 'p-water', { name: 'Water', priceMinor: 199, taxRateId: 'r1', stock: 20, updatedAt: '2026-10-12T10:00:00.000Z' }));

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

  it('the Tax box: a rate is added with its name and percentage, says what is wrong first, and is changed', async () => {
    const GST = { id: 'r2', name: 'GST', bp: 1800, products: 0, membershipTypes: 0, memberships: 0 };
    svc.addTaxRate.mockResolvedValue(page({ tax: { included: false, rates: [GST, RATE] } }));
    svc.changeTaxRate.mockResolvedValue(page({ tax: { included: false, rates: [{ ...GST, bp: 1200 }, RATE] } }));
    open();
    await screen.findByRole('region', { name: 'Tax' });
    expect(within(taxBox()).getByText('Tax is added on top of the price of each product and membership that charges it.')).toBeTruthy();
    expect(within(taxBox()).getAllByTestId('tax-rate-row').map((r) => r.textContent)).toEqual([expect.stringContaining('Sales tax 8.25%Charged on 2 products.')]);
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'Add a tax rate' }));
    const form = within(within(taxBox()).getByRole('form', { name: 'Add a tax rate' }));
    fireEvent.click(form.getByRole('button', { name: 'Add tax rate' }));
    expect(form.getByText('Give the tax a name, such as GST, VAT or Sales tax.')).toBeTruthy();
    expect(form.getByText('Enter the rate as a number above 0 and up to 30, like 8.25.')).toBeTruthy();
    expect(svc.addTaxRate).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Tax name'), { target: { value: ' GST ' } });
    fireEvent.change(form.getByLabelText('Rate, in percent'), { target: { value: '18' } });
    fireEvent.click(form.getByRole('button', { name: 'Add tax rate' }));
    await waitFor(() => expect(svc.addTaxRate).toHaveBeenCalledWith('g1', { name: 'GST', bp: 1800 }));
    expect(await within(taxBox()).findByText('GST 18% added. Now tick what charges it.')).toBeTruthy();
    // A new rate charges nothing: the box to tick what charges it opens under it by itself.
    expect(within(taxBox()).getByRole('group', { name: 'What charges GST 18%' })).toBeTruthy();
    fireEvent.click(within(within(taxBox()).getByRole('group', { name: 'What charges GST 18%' })).getByRole('button', { name: 'Cancel' }));
    // A new rate reaches what is made from now on, and the form says so.
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'Change GST' }));
    const change = within(within(taxBox()).getByRole('form', { name: 'Change tax rate' }));
    expect(change.getByLabelText('Rate, in percent').value).toBe('18');
    expect(change.getByText('A new rate is charged on sales and bills from now on. Sales and bills already made keep the tax they were made with.')).toBeTruthy();
    fireEvent.change(change.getByLabelText('Rate, in percent'), { target: { value: '12' } });
    fireEvent.click(change.getByRole('button', { name: 'Save tax rate' }));
    await waitFor(() => expect(svc.changeTaxRate).toHaveBeenCalledWith('g1', 'r2', { name: 'GST', bp: 1200 }));
  });

  it('the Tax box: a rate in use says why it cannot go and sends nothing; one nothing charges is removed after the box is answered', async () => {
    const SPARE = { id: 'r3', name: 'Spare', bp: 500, products: 0, membershipTypes: 0, memberships: 0 };
    const HELD = { ...RATE, memberships: 3 };
    svc.get.mockResolvedValue(page({ tax: { included: false, rates: [SPARE, HELD] } }));
    svc.removeTaxRate.mockResolvedValue(page({ tax: { included: false, rates: [HELD] } }));
    open();
    await screen.findByRole('region', { name: 'Tax' });
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'Remove Sales tax' }));
    expect(within(taxBox()).getByRole('alert').textContent).toBe(
      "Sales tax can't be removed: it is charged on 2 products and 3 members' memberships. Change those to another rate or No tax first. A membership keeps the tax it was sold with, so Sales tax can be removed once nobody holds one.",
    );
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'OK' }));
    expect(svc.removeTaxRate).not.toHaveBeenCalled();
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'Remove Spare' }));
    expect(within(taxBox()).getByText('Remove Spare? Nothing charges it now. Sales and bills already made keep it.')).toBeTruthy();
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'Keep it' }));
    expect(svc.removeTaxRate).not.toHaveBeenCalled();
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'Remove Spare' }));
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(svc.removeTaxRate).toHaveBeenCalledWith('g1', 'r3'));
    expect(await within(taxBox()).findByText('Spare removed.')).toBeTruthy();
  });

  it('the Tax box: Choose products ticks what charges a rate, sends every one ticked, and says it in the same place', async () => {
    svc.chargeTaxRate.mockResolvedValue(page({ products: [TOWEL, product({ taxRateId: null })] }));
    open();
    await screen.findByRole('region', { name: 'Tax' });
    fireEvent.click(within(taxBox()).getByRole('button', { name: 'Choose products for Sales tax' }));
    const box = within(within(taxBox()).getByRole('group', { name: 'What charges Sales tax 8.25%' }));
    expect(box.getByText('Which products charge Sales tax 8.25%?')).toBeTruthy();
    expect(box.getByRole('checkbox', { name: 'Towel' }).checked).toBe(true);
    expect(box.getByRole('checkbox', { name: 'Water' }).checked).toBe(true);
    fireEvent.click(box.getByRole('checkbox', { name: 'Water' }));
    fireEvent.click(box.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(svc.chargeTaxRate).toHaveBeenCalledWith('g1', 'r1', { use: 'products', ids: ['p-towel'] }));
    expect(await within(taxBox()).findByText('Sales tax 8.25% is now charged on Towel.')).toBeTruthy();
    expect(within(taxBox()).queryByRole('group', { name: 'What charges Sales tax 8.25%' })).toBeNull();
  });

  it('the Tax box: how the tax is charged is saved on its own, and says it is saved', async () => {
    svc.saveTaxMode.mockResolvedValue(page({ tax: { included: true, rates: [RATE] } }));
    open();
    await screen.findByRole('region', { name: 'Tax' });
    const save = within(taxBox()).getByRole('button', { name: 'Save' });
    expect(save.disabled).toBe(true);
    fireEvent.click(within(taxBox()).getByLabelText(/Already included in the price/));
    expect(within(taxBox()).getByText('Not saved yet.')).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(svc.saveTaxMode).toHaveBeenCalledWith('g1', { included: true }));
    expect(await within(taxBox()).findByText('Saved. New sales and new memberships use this. Members who already hold a membership keep how it was sold.')).toBeTruthy();
    expect(within(taxBox()).getByText('Your prices include the tax. Each sale and each bill shows how much of it is tax.')).toBeTruthy();
  });

  it('a product picks its tax, and a rate added from inside its form is picked there at once', async () => {
    const GST = { id: 'r2', name: 'GST', bp: 1800, products: 0, membershipTypes: 0, memberships: 0 };
    svc.addTaxRate.mockResolvedValue(page({ tax: { included: false, rates: [GST, RATE] } }));
    svc.addProduct.mockResolvedValue(page());
    open();
    await screen.findByRole('region', { name: 'Products' });
    fireEvent.click(within(products()).getByRole('button', { name: 'Add a product' }));
    const form = within(within(products()).getByRole('form', { name: 'Add a product' }));
    // The gym's one rate is picked to start with.
    expect(form.getByLabelText('Tax').value).toBe('r1');
    expect([...form.getByLabelText('Tax').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['No tax', 'Sales tax 8.25%']);
    fireEvent.click(form.getByRole('button', { name: 'Add a tax rate' }));
    const rate = within(form.getByRole('group', { name: 'Add a tax rate' }));
    fireEvent.change(rate.getByLabelText('Tax name'), { target: { value: 'GST' } });
    fireEvent.change(rate.getByLabelText('Rate, in percent'), { target: { value: '18' } });
    fireEvent.click(rate.getByRole('button', { name: 'Add tax rate' }));
    await waitFor(() => expect(svc.addTaxRate).toHaveBeenCalledWith('g1', { name: 'GST', bp: 1800 }));
    await waitFor(() => expect(form.getByLabelText('Tax').value).toBe('r2'));
    expect(svc.addProduct).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Product name'), { target: { value: 'Shake' } });
    fireEvent.change(form.getByLabelText('Price in USD'), { target: { value: '4' } });
    fireEvent.click(form.getByRole('button', { name: 'Add product' }));
    await waitFor(() => expect(svc.addProduct).toHaveBeenCalledWith('g1', { name: 'Shake', priceMinor: 400, taxRateId: 'r2', stock: null }));
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
    // The tax is read, never changed.
    expect(within(taxBox()).getByText('Tax is added on top of the price of each product and membership that charges it.')).toBeTruthy();
    expect(within(taxBox()).getByText('Sales tax 8.25%')).toBeTruthy();
    expect(within(taxBox()).queryByRole('button', { name: 'Add a tax rate' })).toBeNull();
    expect(within(taxBox()).queryByRole('button', { name: 'Change Sales tax' })).toBeNull();
    expect(within(taxBox()).queryByRole('radio')).toBeNull();
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
    expect(within(today()).queryByRole('button', { name: 'More for the sale of 2 × Water' })).toBeNull();
    expect(within(products()).getByRole('button', { name: 'Add a product' }).disabled).toBe(true);
    expect(within(products()).getByRole('button', { name: 'Change Water' }).disabled).toBe(true);
    expect(within(taxBox()).getByRole('button', { name: 'Add a tax rate' }).disabled).toBe(true);
    expect(within(taxBox()).getByRole('button', { name: 'Change Sales tax' }).disabled).toBe(true);
    expect(within(taxBox()).getByRole('button', { name: 'Remove Sales tax' }).disabled).toBe(true);
    expect(within(taxBox()).getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });
});

describe('refund a sale (18p)', () => {
  const sold = (over = {}) => sale({ canRefund: true, canUndo: false, stockCounted: true, refunds: [], refundedMinor: 0, person: { entryId: 'e-maya', name: 'Maya Patel' }, ...over });
  const moreOf = (row) => within(row).getByRole('button', { name: 'More for the sale of 2 × Water' });

  it('opens inside the sale, filled with all that is left and how it was paid, sends nothing until a reason is picked, and says what it did under the sale', async () => {
    svc.get.mockResolvedValue(withSale(sold()));
    svc.refundSale.mockResolvedValue({ receiptNumber: 42 });
    open();
    const row = (await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row'))[0];
    fireEvent.click(moreOf(row));
    // Void sale is not offered: this sale's own Void is over (the server said so).
    expect(within(row).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Refund saleYou gave some or all of the money back.']);
    fireEvent.click(within(row).getByRole('menuitem', { name: /^Refund sale/ }));
    const box = within(row).getByTestId('sale-refund-form');
    expect(within(box).getByText('Refund sale: 2 × Water')).toBeTruthy();
    expect(within(box).getByText('Sold on 12 Oct 2026 to Maya Patel for $4.31. This only writes the refund in your records: give the money back yourself.')).toBeTruthy();
    expect(within(box).getByLabelText('Amount given back (USD)').value).toBe('4.31');
    expect(within(box).getByLabelText('How you gave it back').value).toBe('cash');
    expect(within(within(box).getByLabelText('How many went back on the shelf')).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', '1', '2']);
    expect(within(within(box).getByLabelText('Why it was refunded')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose one',
      'Brought back',
      'Charged too much',
      'Faulty or damaged',
      'Something else',
    ]);

    fireEvent.click(within(box).getByRole('button', { name: 'Note refund' }));
    expect(within(box).getByRole('alert').textContent).toBe('Pick why it was refunded.');
    fireEvent.change(within(box).getByLabelText('Amount given back (USD)'), { target: { value: '5' } });
    fireEvent.change(within(box).getByLabelText('Why it was refunded'), { target: { value: 'returned' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Note refund' }));
    expect(within(box).getByRole('alert').textContent).toBe('That is more than can be refunded. $4.31 is the most.');
    expect(svc.refundSale).not.toHaveBeenCalled();

    fireEvent.change(within(box).getByLabelText('Amount given back (USD)'), { target: { value: '2.15' } });
    fireEvent.change(within(box).getByLabelText('How many went back on the shelf'), { target: { value: '1' } });
    svc.get.mockResolvedValue(withSale(sold({ refundedMinor: 215 })));
    fireEvent.click(within(box).getByRole('button', { name: 'Note refund' }));
    await waitFor(() => expect(svc.refundSale).toHaveBeenCalledTimes(1));
    expect(svc.refundSale).toHaveBeenCalledWith('g1', 's1', { requestKey: expect.any(String), amountMinor: 215, method: 'cash', reason: 'returned', restock: 1 });
    const after = (await within(today()).findAllByTestId('takings-row'))[0];
    expect((await within(after).findByRole('status')).textContent).toBe('Refund noted: $2.15 back for 2 × Water. 1 went back on the shelf. Its receipt is #42.');
    expect(within(after).getByText('Part refunded')).toBeTruthy();
    expect(svc.get).toHaveBeenCalledTimes(2);
  });

  it('a sale whose stock is not counted is never asked about the shelf, and Back sends nothing', async () => {
    svc.get.mockResolvedValue(withSale(sold({ stockCounted: false })));
    open();
    const row = (await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row'))[0];
    fireEvent.click(moreOf(row));
    fireEvent.click(within(row).getByRole('menuitem', { name: /^Refund sale/ }));
    expect(within(row).queryByLabelText('How many went back on the shelf')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Back' }));
    expect(within(row).queryByTestId('sale-refund-form')).toBeNull();
    expect(svc.refundSale).not.toHaveBeenCalled();
  });

  it('a refund stands under its sale with who, when and why; Void refund asks why and is sent with it; a voided one is crossed out', async () => {
    const refund = { id: 'rf1', amountMinor: 431, method: 'cash', reason: 'faulty', restocked: 0, refundedOn: '2026-10-12', by: 'Priya Desk', receiptNumber: 43, voided: null };
    svc.get.mockResolvedValue(withSale(sold({ canRefund: false, refundedMinor: 431, refunds: [refund] })));
    svc.voidSaleRefund.mockResolvedValue({ voided: true });
    open();
    const row = (await within(await screen.findByRole('region', { name: "Today's takings" })).findAllByTestId('takings-row'))[0];
    expect(within(row).getByText('Refunded')).toBeTruthy();
    // Everything went back: nothing is left to refund, so the sale has no ⋯.
    expect(within(row).queryByRole('button', { name: 'More for the sale of 2 × Water' })).toBeNull();
    const line = within(row).getByTestId('sale-refund');
    expect(line.textContent).toContain('$4.31 refunded');
    expect(line.textContent).toContain('Cash · 12 Oct 2026 · Faulty or damaged · by Priya Desk');
    fireEvent.click(within(line).getByRole('button', { name: 'More for the refund of $4.31, receipt #43' }));
    fireEvent.click(within(line).getByRole('menuitem', { name: /^Void refund/ }));
    const box = within(row).getByTestId('sale-void-refund');
    expect(within(box).getByText('Void the $4.31 refund noted on 12 Oct 2026? It will no longer count, and the sale counts that much again. It stays in the list crossed out.')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Void refund' }));
    expect(within(box).getByRole('alert').textContent).toBe('Pick why you are voiding it.');
    expect(svc.voidSaleRefund).not.toHaveBeenCalled();
    fireEvent.change(within(box).getByLabelText('Why are you voiding it?'), { target: { value: 'wrong_amount' } });
    svc.get.mockResolvedValue(withSale(sold({ refunds: [{ ...refund, voided: { reason: 'wrong_amount', on: '2026-10-12', by: 'Sam Desk' } }] })));
    fireEvent.click(within(box).getByRole('button', { name: 'Void refund' }));
    await waitFor(() => expect(svc.voidSaleRefund).toHaveBeenCalledWith('g1', 's1', 'rf1', { reason: 'wrong_amount' }));
    const after = (await within(today()).findAllByTestId('takings-row'))[0];
    expect((await within(after).findByRole('status')).textContent).toBe('Refund voided. The sale counts $4.31 again.');
    const voided = await within(after).findByTestId('sale-voided-refund');
    expect(voided.textContent).toContain('Voided 12 October 2026 by Sam Desk · Wrong amount');
    expect(within(voided).queryByRole('button', { name: /^More for the refund/ })).toBeNull();
  });

  it('another day is picked from a calendar, its sales are read for that day, and Back to today returns', async () => {
    svc.get.mockImplementation((gymId, day = null) =>
      Promise.resolve(
        day === '2026-10-09'
          ? page({ day: '2026-10-09', sales: [sold({ soldOn: '2026-10-09' })], totals: totals({ count: 1, totalMinor: 431, cash: 431 }) })
          : page({ day: '2026-10-12' }),
      ),
    );
    open();
    await screen.findByRole('region', { name: "Today's takings" });
    fireEvent.click(within(today()).getByRole('button', { name: 'Show another day' }));
    expect(within(today()).getByRole('button', { name: 'Tue 13 Oct 2026' }).disabled).toBe(true);
    fireEvent.click(within(today()).getByRole('button', { name: 'Fri 9 Oct 2026' }));
    const region = await screen.findByRole('region', { name: 'Takings on another day' });
    expect(svc.get).toHaveBeenCalledWith('g1', '2026-10-09');
    await waitFor(() => expect(within(region).getByTestId('takings-line').textContent).toBe('Taken on 9 Oct 2026: $4.31 from 1 sale. Cash $4.31.'));
    expect(within(region).getByRole('heading', { name: '9 Oct 2026' })).toBeTruthy();
    const row = within(region).getAllByTestId('takings-row')[0];
    fireEvent.click(moreOf(row));
    expect(within(row).getByRole('menuitem', { name: /^Refund sale/ })).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Back to today' }));
    expect(await screen.findByRole('region', { name: "Today's takings" })).toBeTruthy();
    expect(within(today()).getByTestId('takings-line').textContent).toBe('Nothing taken yet today.');
  });
});
