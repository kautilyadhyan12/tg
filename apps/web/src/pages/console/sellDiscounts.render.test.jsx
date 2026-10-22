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
  voidSale: vi.fn(),
  saveTaxMode: vi.fn(),
  addTaxRate: vi.fn(),
  changeTaxRate: vi.fn(),
  removeTaxRate: vi.fn(),
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
const orgApi = { getMine: vi.fn(), getMemberList: vi.fn(), getMembershipTypes: vi.fn(), giveHeldMembership: vi.fn(), getTerminalSales: vi.fn() };
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

const WATER = { id: 'p-water', name: 'Water', priceMinor: 199, currency: 'USD', taxRateId: 'r1', stock: null, archivedAt: null, updatedAt: '2026-10-13T10:00:00.000Z' };
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
  forProducts: true,
  allProducts: true,
  productIds: [],
  forMemberships: false,
  allMembershipTypes: true,
  membershipTypeIds: [],
  membershipPayments: null,
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
  tax: { included: false, rates: [{ id: 'r1', name: 'Sales tax', bp: 825, products: 1, membershipTypes: 0, memberships: 0 }] },
  products: [TOWEL, WATER],
  archived: [],
  archivedTotal: 0,
  discounts: [STAFF, discount(), TOWELS],
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
const SOLD = { id: 's1', itemName: 'Water', quantity: 2, unitPriceMinor: 199, netMinor: 318, taxMinor: 26, totalMinor: 344, taxBp: 825, taxName: 'Sales tax', taxIncluded: false, discountName: 'Summer sale', discountMinor: 80, currency: 'USD', method: 'cash', soldOn: '2026-10-13', soldAt: '2026-10-13T15:00:00.000Z', by: 'Sam Desk', person: null, undone: false, canUndo: true, receiptNumber: 41 };
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
  // A gym with no Square (18d-vi-b-ii): the sale goes by hand.
  orgApi.getTerminalSales.mockResolvedValue({ data: { square: 'not_offered', isOwner: true, terminals: [], pairTerminal: false, reconnect: false, waiting: [] } });
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
    pick('Add a product', 'p-water');
    pick('How many', '2');
    // Only what can be used on water today is offered: not the towels' one.
    expect(options('Discount')).toEqual(['No discount', 'Staff · $1.00 off', 'Summer sale · 20% off · code SUMMER20']);
    expect(within(newSale()).getByLabelText('Discount').value).toBe('');
    expect(summary()).toBe('Price$3.98Sales tax 8.25%$0.33Total$4.31');
    pick('Discount', 'd-summer');
    expect(summary()).toBe('Price$3.98Discount (Summer sale)-$0.80Sales tax 8.25%$0.26Total$3.44');
    expect(takeButton().textContent).toBe('Take payment · $3.44');

    svc.sell.mockResolvedValue({ saleId: 's1', receiptNumber: 41, register: page({ sales: [SOLD], totals: totals({ count: 1, totalMinor: 344, taxMinor: 26, cash: 344, discountMinor: 80 }) }) });
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(1));
    expect(svc.sell.mock.calls[0][1]).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      entryId: null,
      method: 'cash',
      totalMinor: 344,
      lines: [{ productId: 'p-water', quantity: 2, discountId: 'd-summer', totalMinor: 344 }],
    });
    const done = await within(newSale()).findByTestId('sale-done');
    expect(done.textContent).toContain('Sold: 2 × Water to a walk-in. $3.44, cash. Summer sale: $0.80 off.');
    expect(within(today()).getByTestId('takings-row').textContent).toContain('Summer sale: $0.80 off');
    expect(within(today()).getByText("Discounts took $0.80 off today's product sales. The total above is what was paid.")).toBeTruthy();

    // The next sale starts with no discount: the last one is not carried over.
    fireEvent.click(within(newSale()).getByRole('button', { name: 'New sale' }));
    pick('Add a product', 'p-water');
    expect(within(newSale()).getByLabelText('Discount').value).toBe('');
    expect(within(newSale()).getByLabelText('Promo code').value).toBe('');
    fireEvent.click(takeButton());
    await waitFor(() => expect(svc.sell).toHaveBeenCalledTimes(2));
    expect(svc.sell.mock.calls[1][1]).toMatchObject({ totalMinor: 215, lines: [{ discountId: null }] });
  });

  it('a promo code typed picks its discount, and one that cannot be used says why and picks nothing', async () => {
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Add a product', 'p-water');
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
    expect(summary()).toBe('Price$1.99Sales tax 8.25%$0.16Total$2.15');
    type(' summer20');
    fireEvent.keyDown(within(newSale()).getByLabelText('Promo code'), { key: 'Enter' });
    expect(within(newSale()).getByRole('status').textContent).toBe('SUMMER20 applied: 20% off.');
    expect(within(newSale()).getByLabelText('Discount').value).toBe('d-summer');
    expect(summary()).toBe('Price$1.99Discount (Summer sale)-$0.40Sales tax 8.25%$0.13Total$1.72');

    // A second product is a line of its own (18q): the water keeps its discount, and the towel
    // offers only what can be used on a towel.
    pick('Add a product', 'p-towel');
    const [onWater, onTowel] = within(newSale()).getAllByLabelText('Discount');
    expect([onWater.value, onTowel.value]).toEqual(['d-summer', '']);
    expect(Array.from(onTowel.options).map((o) => o.value)).toEqual(['', 'd-staff', 'd-summer', 'd-towels']);
    fireEvent.click(within(newSale()).getByRole('button', { name: 'Remove Towel' }));
    expect(within(newSale()).getAllByLabelText('Discount').map((d) => d.value)).toEqual(['d-summer']);
  });

  it('a discount that takes the whole price is not sold, and one the server refuses is said and the page read again', async () => {
    svc.get.mockResolvedValue(page({ discounts: [discount({ id: 'd-two', name: 'Two off', code: null, kind: 'amount', percentBp: null, amountMinor: 200, currency: 'USD' }), discount()] }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Add a product', 'p-water');
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
    expect(summary()).toBe('Price$1.99Sales tax 8.25%$0.16Total$2.15');
  });

  it('a gym with no discounts is asked nothing about them', async () => {
    svc.get.mockResolvedValue(page({ discounts: [] }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Add a product', 'p-water');
    expect(within(newSale()).queryByLabelText('Discount')).toBeNull();
    expect(within(newSale()).queryByLabelText('Promo code')).toBeNull();
    expect(within(discounts()).getByText('No discounts for products yet. Add one to take a percentage or a fixed amount off a product, with a promo code if you want one.')).toBeTruthy();
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
    expect(within(form).getByText('Enter the percentage as a number above 0 and under 100, like 10.')).toBeTruthy();
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
      expect(svc.addDiscount).toHaveBeenCalledWith('g1', { name: 'Members week', code: 'WEEK5', kind: 'amount', percentBp: null, amountMinor: 150, startsOn: null, endsOn: null, maxUses: 25, forProducts: true, allProducts: false, productIds: ['p-water'], forMemberships: false, allMembershipTypes: true, membershipTypeIds: [], membershipPayments: null }),
    );
    expect(await within(discounts()).findByText('Members week added. Staff can now choose it when they sell a product.')).toBeTruthy();
    expect(within(discounts()).queryByRole('form')).toBeNull();
    expect(within(discounts()).getByTestId('discount-row').textContent).toBe('Members weekActive$1.50 off · Promo code WEEK5 · Water · Used 0 of 25ChangeArchive');
  });

  it('a discount for memberships: ticked instead of products, limited to the ones ticked, and asked how often before it is sent', async () => {
    const types = [{ id: 't-gold', name: 'Gold Monthly' }, { id: 't-pass', name: 'Day pass' }];
    svc.get.mockResolvedValue(page({ discounts: [], membershipTypes: types }));
    open();
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Discounts' })).findByRole('button', { name: 'Add a discount' }));
    const form = within(within(discounts()).getByRole('form', { name: 'Add a discount' }));
    fireEvent.change(form.getByLabelText('Discount name'), { target: { value: 'First month' } });
    fireEvent.change(form.getByRole('textbox', { name: 'Percentage off' }), { target: { value: '20' } });
    fireEvent.click(form.getByRole('checkbox', { name: 'Products' }));
    fireEvent.click(form.getByRole('button', { name: 'Add discount' }));
    expect(form.getByText('Tick products, memberships, or both.')).toBeTruthy();
    fireEvent.click(form.getByRole('checkbox', { name: 'Memberships' }));
    fireEvent.click(form.getByLabelText('Selected memberships'));
    fireEvent.click(form.getByRole('button', { name: 'Add discount' }));
    expect(form.getByText('Tick at least one membership.')).toBeTruthy();
    expect(form.getByText('Choose whether it comes off the first payment only or every payment.')).toBeTruthy();
    expect(svc.addDiscount).not.toHaveBeenCalled();
    fireEvent.click(form.getByRole('checkbox', { name: 'Gold Monthly' }));
    fireEvent.click(form.getByLabelText('First payment only'));
    const added = discount({ id: 'd-first', name: 'First month', code: null, forProducts: false, forMemberships: true, allMembershipTypes: false, membershipTypeIds: ['t-gold'], membershipPayments: 'first' });
    svc.addDiscount.mockResolvedValue(page({ discounts: [added], membershipTypes: types }));
    fireEvent.click(form.getByRole('button', { name: 'Add discount' }));
    await waitFor(() =>
      expect(svc.addDiscount).toHaveBeenCalledWith('g1', {
        name: 'First month',
        code: null,
        kind: 'percent',
        percentBp: 2000,
        amountMinor: null,
        startsOn: null,
        endsOn: null,
        maxUses: null,
        forProducts: false,
        allProducts: true,
        productIds: [],
        forMemberships: true,
        allMembershipTypes: false,
        membershipTypeIds: ['t-gold'],
        membershipPayments: 'first',
      }),
    );
    // Made on Sell for memberships only: it is listed on the Memberships page, and the line says so with its button.
    expect(await within(discounts()).findByText("First month added. Staff can now choose it when they add a membership on a member's page. It is for memberships only, so it is listed on the Memberships page.")).toBeTruthy();
    expect(within(discounts()).getByRole('link', { name: 'Open Memberships' })).toBeTruthy();
    expect(within(discounts()).queryByTestId('discount-row')).toBeNull();
  });

  it('a gym with no membership types is told so in the form, with a button to Memberships', async () => {
    svc.get.mockResolvedValue(page({ discounts: [], membershipTypes: [] }));
    open();
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Discounts' })).findByRole('button', { name: 'Add a discount' }));
    const form = within(within(discounts()).getByRole('form', { name: 'Add a discount' }));
    fireEvent.click(form.getByRole('checkbox', { name: 'Memberships' }));
    expect(form.getByText('You have no memberships on your price list yet.')).toBeTruthy();
    expect(form.getByRole('link', { name: 'Open Memberships' })).toBeTruthy();
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
      expect(svc.changeDiscount).toHaveBeenCalledWith('g1', 'd-summer', { name: 'Summer sale', code: 'SUMMER20', kind: 'percent', percentBp: 2500, amountMinor: null, startsOn: null, endsOn: null, maxUses: null, forProducts: true, allProducts: true, productIds: [], forMemberships: false, allMembershipTypes: true, membershipTypeIds: [], membershipPayments: null, updatedAt: '2026-10-13T10:00:00.000Z' }),
    );
    expect(await within(discounts()).findByText('Summer sale saved. Sales and memberships already made keep the discount they were made with.')).toBeTruthy();

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
    pick('Add a product', 'p-towel');
    expect(options('Discount')).toEqual(['No discount', 'Staff · $1.00 off', 'Summer sale · 20% off · code SUMMER20', 'Towels only · 10% off · code TOWEL']);
  });

describe('what the screen says stays true', () => {
  it('a promo code is said to be applied only while its discount is on the sale', async () => {
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Add a product', 'p-towel');
    fireEvent.change(within(newSale()).getByLabelText('Promo code'), { target: { value: 'towel' } });
    fireEvent.click(within(newSale()).getByRole('button', { name: 'Apply' }));
    expect(within(newSale()).getByRole('status').textContent).toBe('TOWEL applied: 10% off.');
    expect(within(newSale()).getByLabelText('Discount').value).toBe('d-towels');
    // Water is added: the towel keeps its discount, and the code is still said to be applied.
    pick('Add a product', 'p-water');
    expect(within(newSale()).getAllByLabelText('Discount').map((d) => d.value)).toEqual(['d-towels', '']);
    expect(within(newSale()).getByRole('status').textContent).toBe('TOWEL applied: 10% off.');
    // The towel is taken off the sale: the towels' discount is off it too, and the line says so.
    fireEvent.click(within(newSale()).getByRole('button', { name: 'Remove Towel' }));
    expect(within(newSale()).queryByText('TOWEL applied: 10% off.')).toBeNull();
    expect(within(newSale()).getByRole('status').textContent).toBe('Towels only does not apply to Water. No discount is on this sale.');
    expect(summary()).toBe('Price$1.99Sales tax 8.25%$0.16Total$2.15');
    // Another discount picked by hand: nothing is said of the code any more.
    pick('Discount', 'd-summer');
    expect(within(newSale()).queryByRole('status')).toBeNull();
  });

  it('a code applied and then used up by somebody else is no longer said to be applied', async () => {
    svc.get.mockResolvedValue(page({ discounts: [discount({ maxUses: 5, uses: 4 })] }));
    open();
    await screen.findByRole('region', { name: 'New sale' });
    pick('Add a product', 'p-water');
    fireEvent.change(within(newSale()).getByLabelText('Promo code'), { target: { value: 'summer20' } });
    fireEvent.click(within(newSale()).getByRole('button', { name: 'Apply' }));
    expect(within(newSale()).getByRole('status').textContent).toBe('SUMMER20 applied: 20% off.');
    svc.sell.mockRejectedValue(refusal(409, 'Summer sale has reached its usage limit. Nothing was sold: pick another discount, or sell without one.'));
    svc.get.mockResolvedValue(page({ discounts: [discount({ maxUses: 5, uses: 5 })] }));
    fireEvent.click(takeButton());
    await waitFor(() => expect(within(newSale()).getByText('No discount applies to this product today.')).toBeTruthy());
    expect(within(newSale()).queryByText('SUMMER20 applied: 20% off.')).toBeNull();
    expect(within(newSale()).getByRole('status').textContent).toBe('Summer sale has reached its usage limit. No discount is on this sale.');
  });

  it('a fixed amount in the money used before the gym changed country reads Needs saving, and both places say what to do', async () => {
    const water = { ...WATER, currency: 'GBP' };
    svc.get.mockResolvedValue(page({ currency: 'GBP', products: [water], discounts: [STAFF] }));
    open();
    await screen.findByRole('region', { name: 'Discounts' });
    expect(within(discounts()).getByTestId('discount-row').textContent).toBe(
      'StaffNeeds saving$1.00 off · No promo code · All products · Not used yetThis amount is in USD. Press Change and save it again to use it in GBP.ChangeArchive',
    );
    pick('Add a product', 'p-water');
    expect(within(newSale()).getByText('No discount applies to this product today.')).toBeTruthy();
    expect(within(newSale()).getByText('Staff cannot be used until its amount is saved again in GBP. Open it under Discounts below and press Change.')).toBeTruthy();
    // Change opens it with the amount, to be saved in the gym's money as it is now.
    fireEvent.click(within(discounts()).getByRole('button', { name: 'Change Staff' }));
    expect(within(discounts()).getByLabelText('Amount off, in GBP').value).toBe('1.00');
  });
});
});

describe("Refer a friend's gift under Discounts (the security pass over item 20, H1)", () => {
  const GIFT = discount({ id: 'd-gift', name: "Refer a friend: friend's gift, WELCOME20", code: 'WELCOME20', referralGift: true });
  const MANAGER = { ...ORG, staffRole: 'manager', privileges: ['members.read', 'billing.members', 'memberships.manage'] };

  it('has no Change: whoever sets the offer is taken to Refer a friend, anybody else is told the owner changes it there; Archive stays', async () => {
    svc.get.mockResolvedValue(page({ discounts: [GIFT, discount()] }));
    open();
    await screen.findByRole('region', { name: 'Discounts' });
    const rows = within(discounts()).getAllByTestId('discount-row');
    const giftRow = within(rows[0]);
    expect(giftRow.queryByRole('button', { name: /^Change / })).toBeNull();
    expect(giftRow.getByRole('link', { name: 'Change in Refer a friend' }).getAttribute('href')).toBe('/console/iron-house/settings#refer-a-friend');
    expect(giftRow.getByRole('button', { name: "Archive Refer a friend: friend's gift, WELCOME20" })).toBeTruthy();
    // Every other discount keeps its Change.
    expect(within(rows[1]).getByRole('button', { name: 'Change Summer sale' })).toBeTruthy();
  });

  it('for a manager who may not set the offer: a plain line, and no link', async () => {
    svc.get.mockResolvedValue(page({ discounts: [GIFT] }));
    open(MANAGER);
    await screen.findByRole('region', { name: 'Discounts' });
    const giftRow = within(within(discounts()).getByTestId('discount-row'));
    expect(giftRow.getByText('The owner changes this gift in Refer a friend.')).toBeTruthy();
    expect(giftRow.queryByRole('link')).toBeNull();
    expect(giftRow.queryByRole('button', { name: /^Change / })).toBeNull();
  });
});
