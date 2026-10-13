// DISCOUNTS ON THE SELL PAGE, drawn (ROADMAP 18b-ii-a; spec Part 3 §14.3). Only the
// network is mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: send a total the person was not shown, or send a
// discount the person did not pick.
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
  addDiscount: vi.fn(),
  changeDiscount: vi.fn(),
  archiveDiscount: vi.fn(),
  restoreDiscount: vi.fn(),
  purchases: vi.fn(),
};
const orgApi = { getMine: vi.fn(), getMemberList: vi.fn(), getMembershipTypes: vi.fn(), giveHeldMembership: vi.fn() };
vi.mock('../../api/registerApi', () => ({ registerService: svc }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('./MemberListPerson', () => ({ default: () => null }));

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

const WATER = { id: 'p-water', name: 'Water', priceMinor: 199, currency: 'USD', taxed: true, stock: null, archivedAt: null, updatedAt: '2026-10-13T10:00:00.000Z' };
const TOWEL = { ...WATER, id: 'p-towel', name: 'Towel', priceMinor: 500 };
const discount = (over = {}) => ({
  id: 'd-summer',
  name: 'Summer sale',
  code: 'SUMMER20',
  kind: 'percent',
  percentBp: 2000,
  amountMinor: null,
  currency: null,
  startsOn: null,
  endsOn: null,
  maxUses: null,
  uses: 0,
  allProducts: true,
  productIds: [],
  archivedAt: null,
  updatedAt: '2026-10-13T10:00:00.000Z',
  ...over,
});
const TOWELS = discount({ id: 'd-towels', name: 'Towels only', code: 'TOWEL', percentBp: 1000, allProducts: false, productIds: ['p-towel'] });
const STAFF = discount({ id: 'd-staff', name: 'Staff', code: null, kind: 'amount', percentBp: null, amountMinor: 100, currency: 'USD' });
const totals = (over = {}) => ({ count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, discountMinor: 0, otherCurrency: 0, ...over });
const page = (over = {}) => ({
  currency: 'USD',
  today: '2026-10-13',
  tax: { bp: 825, included: false },
  products: [TOWEL, WATER],
  archived: [],
  archivedTotal: 0,
  discounts: [STAFF, discount(), TOWELS],
  archivedDiscounts: [],
  archivedDiscountsTotal: 0,
  canSell: true,
  canManage: true,
  sales: [],
  salesNotShown: 0,
  payments: [],
  paymentsNotShown: 0,
  totals: totals(),
  ...over,
});
const SOLD = { id: 's1', itemName: 'Water', quantity: 2, unitPriceMinor: 199, netMinor: 318, taxMinor: 26, totalMinor: 344, taxBp: 825, taxIncluded: false, discountName: 'Summer sale', discountMinor: 80, currency: 'USD', method: 'cash', soldOn: '2026-10-13', soldAt: '2026-10-13T15:00:00.000Z', by: 'Sam Desk', person: null, undone: false, canUndo: true };
const refusal = (status, message) => Object.assign(new Error(message), { response: { status, data: { message } } });

const open = (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/sell']}>
      <Routes>
        <Route path="/console/:orgSlug/sell" element={<Sell />} />
      </Routes>
    </MemoryRouter>,
  );
};
const newSale = () => screen.getByRole('region', { name: 'New sale' });
const today = () => screen.getByRole('region', { name: "Today's takings" });
const discounts = () => screen.getByRole('region', { name: 'Discounts' });
const pick = (label, value) => fireEvent.change(within(newSale()).getByLabelText(label), { target: { value } });
const takeButton = () => within(newSale()).getByRole('button', { name: /^Take payment/ });
const summary = () => within(newSale()).getByTestId('sale-summary').textContent;
const options = (label) => [...within(newSale()).getByLabelText(label).querySelectorAll('option')].map((o) => o.textContent);

beforeEach(() => {
  resetConsoleOrgs();
  svc.get.mockResolvedValue(page());
  svc.findPeople.mockResolvedValue([]);
  orgApi.getMemberList.mockResolvedValue({ data: { list: null } });
  orgApi.getMembershipTypes.mockResolvedValue({ data: { types: [] } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('a sale with a discount', () => {
  it('shows the price, the discount, the tax and the total before the press, and sends that total with that discount', async () => {
    open();
    await screen.findByRole('region', { name: 'New sale' });
    // No product picked yet: there is nothing to discount, so nothing is offered.
    expect(within(newSale()).queryByLabelText('Discount')).toBeNull();
    pick('Product', 'p-water');
    pick('How many', '2');
    // Only what can be used on water today is offered: not the towels' one.
    expect(options('Discount')).toEqual(['No discount', 'Staff · $1.00 off', 'Summer sale · 20% off · code SUMMER20']);
    expect(within(newSale()).getByLabelText('Discount').value).toBe('');
    expect(summary()).toBe('Price$3.98Tax (8.25%)$0.33Total$4.31');
    pick('Discount', 'd-summer');
    expect(summary()).toBe('Price$3.98Discount (Summer sale)-$0.80Tax (8.25%)$0.26Total$3.44');
    expect(takeButton().textContent).toBe('Take payment · $3.44');

    svc.sell.mockResolvedValue({ saleId: 's1', register: page({ sales: [SOLD], totals: totals({ count: 1, totalMinor: 344, taxMinor: 26, cash: 344, discountMinor: 80 }) }) });
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(1));
    expect(svc.sell.mock.calls[0][1]).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), productId: 'p-water', quantity: 2, entryId: null, method: 'cash', totalMinor: 344, discountId: 'd-summer' });
    const done = await within(newSale()).findByTestId('sale-done');
    expect(done.textContent).toContain('Sold: 2 × Water to a walk-in. $3.44, cash. Summer sale: $0.80 off.');
    expect(within(today()).getByTestId('takings-row').textContent).toContain('Summer sale: $0.80 off');
    expect(within(today()).getByText("Discounts took $0.80 off today's product sales. The total above is what was paid.")).toBeTruthy();

    // The next sale starts with no discount: the last one is not carried over.
    fireEvent.click(within(newSale()).getByRole('button', { name: 'New sale' }));
    pick('Product', 'p-water');
    expect(within(newSale()).getByLabelText('Discount').value).toBe('');
    expect(within(newSale()).getByLabelText('Promo code').value).toBe('');
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(2));
    expect(svc.sell.mock.calls[1][1]).toMatchObject({ totalMinor: 215, discountId: null });
  });

  it('a promo code typed picks its discount, and one that cannot be used says why and picks nothing', async () => {
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-water');
    const apply = () => fireEvent.click(within(newSale()).getByRole('button', { name: 'Apply' }));
    const type = (text) => fireEvent.change(within(newSale()).getByLabelText('Promo code'), { target: { value: text } });
    expect(within(newSale()).getByText('If the customer gives a code, type it here and press Apply.')).toBeTruthy();
    type('towel');
    apply();
    expect(within(newSale()).getByRole('status').textContent).toBe('Towels only does not apply to Water.');
    expect(within(newSale()).getByLabelText('Discount').value).toBe('');
    type('summer2');
    apply();
    expect(within(newSale()).getByRole('status').textContent).toBe('There is no promo code SUMMER2. Check the spelling with the customer.');
    expect(summary()).toBe('Price$1.99Tax (8.25%)$0.16Total$2.15');
    type(' summer20');
    fireEvent.keyDown(within(newSale()).getByLabelText('Promo code'), { key: 'Enter' });
    expect(within(newSale()).getByRole('status').textContent).toBe('SUMMER20 applied: 20% off.');
    expect(within(newSale()).getByLabelText('Discount').value).toBe('d-summer');
    expect(summary()).toBe('Price$1.99Discount (Summer sale)-$0.40Tax (8.25%)$0.13Total$1.72');

    // The product is changed to one the picked discount is not for: it falls back to none.
    pick('Discount', 'd-staff');
    pick('Product', 'p-towel');
    expect(within(newSale()).getByLabelText('Discount').value).toBe('d-staff');
    pick('Discount', 'd-towels');
    pick('Product', 'p-water');
    expect(within(newSale()).getByLabelText('Discount').value).toBe('');
    expect(summary()).toBe('Price$1.99Tax (8.25%)$0.16Total$2.15');
  });

  it('a discount that takes the whole price is not sold, and one the server refuses is said and the page read again', async () => {
    svc.get.mockResolvedValue(page({ discounts: [discount({ id: 'd-two', name: 'Two off', code: null, kind: 'amount', percentBp: null, amountMinor: 200, currency: 'USD' }), discount()] }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-water');
    pick('Discount', 'd-two');
    expect(takeButton().disabled).toBe(true);
    expect(within(newSale()).getByText('Two off takes off the whole price, so there is nothing to pay. Choose No discount, or another one.')).toBeTruthy();
    fireEvent.click(takeButton());
    expect(svc.sell).not.toHaveBeenCalled();

    pick('Discount', 'd-summer');
    svc.sell.mockRejectedValue(refusal(409, 'Summer sale has reached its usage limit. Nothing was sold: pick another discount, or sell without one.'));
    // What the page reads after the refusal: the discount is used up now, so it is no longer offered.
    svc.get.mockResolvedValue(page({ discounts: [discount({ maxUses: 5, uses: 5 })] }));
    fireEvent.click(takeButton());
    expect(await within(newSale()).findByText('Summer sale has reached its usage limit. Nothing was sold: pick another discount, or sell without one.')).toBeTruthy();
    await waitFor(() => expect(within(newSale()).getByText('No discount applies to this product today.')).toBeTruthy());
    expect(summary()).toBe('Price$1.99Tax (8.25%)$0.16Total$2.15');
  });

  it('a gym with no discounts is asked nothing about them', async () => {
    svc.get.mockResolvedValue(page({ discounts: [] }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Product', 'p-water');
    expect(within(newSale()).queryByLabelText('Discount')).toBeNull();
    expect(within(newSale()).queryByLabelText('Promo code')).toBeNull();
    expect(within(discounts()).getByText('No discounts yet. Add one to take a percentage or a fixed amount off a product, with a promo code if you want one.')).toBeTruthy();
  });
});

describe('the Discounts list', () => {
  it('lists each discount with what it is, and adds one from the form', async () => {
    svc.get.mockResolvedValue(page({ discounts: [discount({ startsOn: '2026-06-01', endsOn: '2026-12-31', maxUses: 100, uses: 3 }), TOWELS, discount({ id: 'd-old', name: 'Spring', code: null, endsOn: '2026-04-30' })] }));
    open();
    await screen.findByRole('region', { name: 'Discounts' });
    expect(within(discounts()).getAllByTestId('discount-row').map((r) => r.textContent)).toEqual([
      'Summer saleActive20% off · Promo code SUMMER20 · All products · 1 Jun 2026 to 31 Dec 2026 · Used 3 of 100ChangeArchive',
      'Towels onlyActive10% off · Promo code TOWEL · Towel · Not used yetChangeArchive',
      'SpringExpired20% off · No promo code · All products · Until 30 Apr 2026 · Not used yetChangeArchive',
    ]);

    fireEvent.click(within(discounts()).getByRole('button', { name: 'Add a discount' }));
    const form = within(discounts()).getByRole('form', { name: 'Add a discount' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add discount' }));
    expect(within(form).getByText('Give the discount a name.')).toBeTruthy();
    expect(within(form).getByText('Enter the percentage as a number above 0 and up to 100, like 10.')).toBeTruthy();
    expect(svc.addDiscount).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText('Discount name'), { target: { value: ' Members week ' } });
    fireEvent.click(within(form).getByLabelText('Fixed amount off'));
    fireEvent.change(within(form).getByLabelText('Amount off, in USD'), { target: { value: '1.50' } });
    fireEvent.change(within(form).getByLabelText('Promo code (optional)'), { target: { value: 'week5' } });
    fireEvent.click(within(form).getByLabelText('Selected products'));
    fireEvent.click(within(form).getByRole('button', { name: 'Add discount' }));
    expect(within(form).getByText('Tick at least one product.')).toBeTruthy();
    fireEvent.click(within(form).getByLabelText('Water'));
    fireEvent.click(within(form).getByLabelText('Limit how many times it can be used'));
    fireEvent.change(within(form).getByLabelText('Usage limit'), { target: { value: '25' } });
    const added = discount({ id: 'd-week', name: 'Members week', code: 'WEEK5', kind: 'amount', percentBp: null, amountMinor: 150, currency: 'USD', maxUses: 25, allProducts: false, productIds: ['p-water'] });
    svc.addDiscount.mockResolvedValue(page({ discounts: [added] }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add discount' }));
    await waitFor(() =>
      expect(svc.addDiscount).toHaveBeenCalledWith('g1', { name: 'Members week', code: 'WEEK5', kind: 'amount', percentBp: null, amountMinor: 150, startsOn: null, endsOn: null, maxUses: 25, allProducts: false, productIds: ['p-water'] }),
    );
    expect(await within(discounts()).findByText('Members week added. Staff can now choose it on the sale form above.')).toBeTruthy();
    expect(within(discounts()).queryByRole('form')).toBeNull();
    expect(within(discounts()).getByTestId('discount-row').textContent).toBe('Members weekActive$1.50 off · Promo code WEEK5 · Water · Used 0 of 25ChangeArchive');
  });

  it('changes one, archives it after asking, and puts it back', async () => {
    svc.get.mockResolvedValue(page({ discounts: [discount({ uses: 4 })] }));
    open();
    await screen.findByRole('region', { name: 'Discounts' });
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Change Summer sale' }));
    const form = within(discounts()).getByRole('form', { name: 'Change discount' });
    expect(within(form).getByLabelText('Discount name').value).toBe('Summer sale');
    expect(within(form).getByLabelText('Percentage off', { selector: 'input[inputmode]' }).value).toBe('20');
    expect(within(form).getByLabelText('Promo code (optional)').value).toBe('SUMMER20');
    fireEvent.change(within(form).getByLabelText('Percentage off', { selector: 'input[inputmode]' }), { target: { value: '25' } });
    svc.changeDiscount.mockResolvedValue(page({ discounts: [discount({ percentBp: 2500, uses: 4 })] }));
    fireEvent.click(within(form).getByRole('button', { name: 'Save discount' }));
    await waitFor(() =>
      expect(svc.changeDiscount).toHaveBeenCalledWith('g1', 'd-summer', { name: 'Summer sale', code: 'SUMMER20', kind: 'percent', percentBp: 2500, amountMinor: null, startsOn: null, endsOn: null, maxUses: null, allProducts: true, productIds: [], updatedAt: '2026-10-13T10:00:00.000Z' }),
    );
    expect(await within(discounts()).findByText('Summer sale saved. Sales already made keep the discount they were sold with.')).toBeTruthy();

    // Archive asks first, and Keep it changes nothing.
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Archive Summer sale' }));
    expect(within(discounts()).getByText('Archive Summer sale? It can no longer be used. Sales already made with it keep it, and you can put it back.')).toBeTruthy();
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Keep it' }));
    expect(svc.archiveDiscount).not.toHaveBeenCalled();
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Archive Summer sale' }));
    const gone = discount({ percentBp: 2500, uses: 4, archivedAt: '2026-10-13T16:00:00.000Z' });
    svc.archiveDiscount.mockResolvedValue(page({ discounts: [], archivedDiscounts: [gone], archivedDiscountsTotal: 1 }));
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(svc.archiveDiscount).toHaveBeenCalledWith('g1', 'd-summer'));
    expect(await within(discounts()).findByText('Summer sale archived. Find it under Archived discounts below.')).toBeTruthy();
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Show archived discounts (1)' }));
    expect(within(discounts()).getByTestId('archived-discount-row').textContent).toContain('Summer sale · 25% off');
    svc.restoreDiscount.mockResolvedValue(page({ discounts: [discount({ percentBp: 2500, uses: 4 })] }));
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Put Summer sale back' }));
    await waitFor(() => expect(svc.restoreDiscount).toHaveBeenCalledWith('g1', 'd-summer'));
    expect(await within(discounts()).findByText('Summer sale can be used again.')).toBeTruthy();
  });

  it('a refused save is said in the form, which stays open with what was typed', async () => {
    svc.get.mockResolvedValue(page({ discounts: [] }));
    open();
    await screen.findByRole('region', { name: 'Discounts' });
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Add a discount' }));
    const form = within(discounts()).getByRole('form', { name: 'Add a discount' });
    fireEvent.change(within(form).getByLabelText('Discount name'), { target: { value: 'Autumn' } });
    fireEvent.change(within(form).getByLabelText('Percentage off', { selector: 'input[inputmode]' }), { target: { value: '15' } });
    svc.addDiscount.mockRejectedValue(refusal(409, 'Another discount already uses this promo code. Pick another code.'));
    fireEvent.click(within(form).getByRole('button', { name: 'Add discount' }));
    expect(await within(form).findByText('Another discount already uses this promo code. Pick another code.')).toBeTruthy();
    expect(within(form).getByLabelText('Discount name').value).toBe('Autumn');
  });

  it('staff who sell but cannot change prices read the list, use it, and are told who can change it', async () => {
    svc.get.mockResolvedValue(page({ canManage: false }));
    open(SELLER);
    await screen.findByRole('region', { name: 'Discounts' });
    expect(within(discounts()).getAllByTestId('discount-row')).toHaveLength(3);
    expect(within(discounts()).queryByRole('button', { name: 'Add a discount' })).toBeNull();
    expect(within(discounts()).queryByRole('button', { name: /^Change / })).toBeNull();
    expect(within(discounts()).queryByRole('button', { name: /^Archive / })).toBeNull();
    expect(within(discounts()).getByText('The owner, or staff who can change membership types and prices, can add and change discounts.')).toBeTruthy();
    pick('Product', 'p-towel');
    expect(options('Discount')).toEqual(['No discount', 'Staff · $1.00 off', 'Summer sale · 20% off · code SUMMER20', 'Towels only · 10% off · code TOWEL']);
  });
});
