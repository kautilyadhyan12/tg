// THE SELL PAGE'S WORDS AND SUMS (ROADMAP 18b-i; spec Part 3 §14.3).
import { describe, expect, it } from 'vitest';
import { ROLE_PRIVILEGES } from '@app/shared';
import {
  HIDDEN_TEXT,
  canManageProducts,
  canOpenSell,
  canSell,
  canSellMemberships,
  chargeChoices,
  rateChangeNote,
  chargedWords,
  draftFromProduct,
  emptyProductDraft,
  personOption,
  productBody,
  productOption,
  productProblems,
  productRow,
  purchaseLine,
  quantityMax,
  saleProblem,
  saleSummary,
  soldWords,
  takingsNotes,
  takingsRows,
  takingsWords,
  draftFromRate,
  emptyRateDraft,
  rateBody,
  rateProblems,
  rateRemoveBlock,
  rateUses,
  saleTaxWords,
  taxLine,
  taxModes,
  undoSaleQuestion,
} from './sellView';

const water = (over = {}) => ({ id: 'p1', name: 'Water', priceMinor: 199, currency: 'USD', taxRateId: 'r1', stock: null, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z', ...over });
const rate = (over = {}) => ({ id: 'r1', name: 'Sales tax', bp: 825, products: 0, membershipTypes: 0, memberships: 0, ...over });
const NO_TAX = { included: false, rates: [] };
const TEXAS = { included: false, rates: [rate()] };
const UK = { included: true, rates: [rate({ name: 'VAT', bp: 2000 })] };
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
  currency: 'USD',
  method: 'cash',
  soldOn: '2026-10-12',
  soldAt: '2026-10-12T14:05:00.000Z',
  by: 'Sam Desk',
  person: { entryId: 'e1', name: 'Maya Patel' },
  undone: false,
  canUndo: true,
  ...over,
});
const totals = (over = {}) => ({ count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, otherCurrency: 0, ...over });
const page = (over = {}) => ({ currency: 'USD', sales: [], payments: [], salesNotShown: 0, paymentsNotShown: 0, totals: totals(), ...over });

describe('who may', () => {
  it('each tick opens its own half, and either opens the page', () => {
    expect(canSell(['billing.members'])).toBe(true);
    expect(canSell(['memberships.manage'])).toBe(false);
    expect(canManageProducts(['memberships.manage'])).toBe(true);
    expect(canManageProducts(['billing.members'])).toBe(false);
    expect(canOpenSell(['billing.members'])).toBe(true);
    expect(canOpenSell(['memberships.manage'])).toBe(true);
    expect(canOpenSell(['members.read', 'members.confirm'])).toBe(false);
    expect(canOpenSell(null)).toBe(false);
    expect(canOpenSell(undefined)).toBe(false);
  });
  it('a membership is sold here only by somebody who may also open the person’s page', () => {
    expect(canSellMemberships(['billing.members'])).toBe(false);
    expect(canSellMemberships(['billing.members', 'members.confirm'])).toBe(true);
    expect(canSellMemberships(['members.confirm'])).toBe(false);
  });
  it('an owner and a manager have the page, a trainer does not', () => {
    expect(canOpenSell(ROLE_PRIVILEGES.owner)).toBe(true);
    expect(canOpenSell(ROLE_PRIVILEGES.manager)).toBe(true);
    expect(canOpenSell(ROLE_PRIVILEGES.trainer)).toBe(false);
  });
});

describe('the sale as it is shown', () => {
  it('a product in the picker says its price and what is left', () => {
    expect(productOption(water())).toBe('Water · $1.99');
    expect(productOption(water({ stock: 8 }))).toBe('Water · $1.99 · 8 left');
    expect(productOption(water({ stock: 0 }))).toBe('Water · $1.99 · out of stock');
    expect(productOption(water({ currency: 'GBP' }))).toBe('Water · £1.99');
  });
  it('how many one sale can hold', () => {
    expect(quantityMax(null)).toBe(99);
    expect(quantityMax(water())).toBe(99);
    expect(quantityMax(water({ stock: 4 }))).toBe(4);
    expect(quantityMax(water({ stock: 500 }))).toBe(99);
  });
  it('no tax: one line, the total', () => {
    expect(saleSummary(water(), 2, NO_TAX)).toEqual({ totalMinor: 398, total: '$3.98', lines: [{ label: 'Total', value: '$3.98', strong: true }] });
  });
  it('tax on top: the price, the tax on a line of its own, then the total', () => {
    expect(saleSummary(water(), 2, TEXAS)).toEqual({
      totalMinor: 431,
      total: '$4.31',
      lines: [
        { label: 'Price', value: '$3.98' },
        { label: 'Sales tax 8.25%', value: '$0.33' },
        { label: 'Total', value: '$4.31', strong: true },
      ],
    });
  });
  it('tax inside the price: the total is the price, and the tax is said under it', () => {
    expect(saleSummary(water({ currency: 'GBP' }), 1, UK)).toEqual({
      totalMinor: 199,
      total: '£1.99',
      lines: [
        { label: 'Total', value: '£1.99', strong: true },
        { label: 'Includes VAT 20%', value: '£0.33' },
      ],
    });
  });
  it('a product the gym does not tax shows no tax line, whatever the rate', () => {
    expect(saleSummary(water({ taxRateId: null }), 1, TEXAS).lines).toEqual([{ label: 'Total', value: '$1.99', strong: true }]);
    expect(saleSummary(water({ taxRateId: null }), 1, UK).lines).toEqual([{ label: 'Total', value: '$1.99', strong: true }]);
    // A rate since removed is no tax, never a guess at one.
    expect(saleSummary(water({ taxRateId: 'r-gone' }), 1, TEXAS).lines).toEqual([{ label: 'Total', value: '$1.99', strong: true }]);
  });
  it('each product charges its own rate, by its own name', () => {
    const two = { included: false, rates: [rate(), rate({ id: 'r2', name: 'Food tax', bp: 200 })] };
    expect(saleSummary(water(), 1, two).lines[1]).toEqual({ label: 'Sales tax 8.25%', value: '$0.16' });
    expect(saleSummary(water({ taxRateId: 'r2' }), 1, two).lines).toEqual([
      { label: 'Price', value: '$1.99' },
      { label: 'Food tax 2%', value: '$0.04' },
      { label: 'Total', value: '$2.03', strong: true },
    ]);
  });
  it('nothing to add up with no product, or a number that is not one', () => {
    expect(saleSummary(null, 1, NO_TAX)).toBeNull();
    expect(saleSummary(water(), 0, NO_TAX)).toBeNull();
    expect(saleSummary(water(), 100, NO_TAX)).toBeNull();
  });
  it('why the button is off', () => {
    const ok = { product: water({ stock: 3 }), quantity: 2, who: 'walkin', person: null };
    expect(saleProblem(ok)).toBeNull();
    expect(saleProblem({ ...ok, product: null })).toBe('Pick a product.');
    expect(saleProblem({ ...ok, product: water({ stock: 0 }) })).toBe('Water is out of stock. Change its stock count under Products if you have more.');
    expect(saleProblem({ ...ok, quantity: Number.NaN })).toBe('Enter how many, 1 or more.');
    expect(saleProblem({ ...ok, quantity: 0 })).toBe('Enter how many, 1 or more.');
    expect(saleProblem({ ...ok, quantity: 4 })).toBe('Only 3 left in stock.');
    expect(saleProblem({ ...ok, product: water(), quantity: 100 })).toBe('One sale can hold up to 99.');
    expect(saleProblem({ ...ok, who: 'member' })).toBe('Find and pick the member, or choose Walk-in.');
    expect(saleProblem({ ...ok, who: 'member', person: { entryId: 'e1', name: 'Maya' } })).toBeNull();
    // Priced in the money the gym used before it changed its country: not sold until saved again.
    expect(saleProblem({ ...ok, currency: 'USD' })).toBeNull();
    expect(saleProblem({ ...ok, currency: 'GBP' })).toBe('Water is priced in USD, and you now sell in GBP. Open Water under Products and save its price in GBP.');
  });
  it('what is said once it is sold', () => {
    expect(soldWords(sale())).toBe('Sold: 2 × Water to Maya Patel. $4.31, cash.');
    expect(soldWords(sale({ person: null, method: 'card_at_desk', quantity: 1, totalMinor: 215 }))).toBe('Sold: 1 × Water to a walk-in. $2.15, card at the desk.');
  });
  it('a person the search found', () => {
    expect(personOption({ name: 'Maya Patel', email: null, memberNumber: null, past: false })).toBe('Maya Patel');
    expect(personOption({ name: 'Maya Patel', email: 'maya@example.com', memberNumber: '1042', past: true })).toBe('Maya Patel · No. 1042 · maya@example.com · Past member');
  });
});

describe('today', () => {
  it('says nothing was taken, or how much and how', () => {
    expect(takingsWords(page())).toBe('Nothing taken yet today.');
    expect(takingsWords(page({ totals: totals({ count: 1, totalMinor: 199, cash: 199 }) }))).toBe('Taken today: $1.99 from 1 sale. Cash $1.99.');
    expect(takingsWords(page({ totals: totals({ count: 3, payments: 1, totalMinor: 5596, cash: 398, card_at_desk: 4999, bank_transfer: 199 }) }))).toBe(
      'Taken today: $55.96 from 3 sales and 1 membership payment. Cash $3.98 · Card at the desk $49.99 · Bank transfer $1.99.',
    );
    // Named as the rows under it name them: one thing, one name.
    expect(takingsWords(page({ currency: 'GBP', totals: totals({ payments: 2, totalMinor: 9000, link: 4000, company: 5000 }) }))).toBe(
      'Taken today: £90.00 from 2 membership payments. Payment link £40.00 · Card on file £50.00.',
    );
  });
  it('the smaller lines are each said only where they are true', () => {
    expect(takingsNotes(page())).toEqual([]);
    expect(takingsNotes(page({ salesNotShown: 2, paymentsNotShown: 1, totals: totals({ taxMinor: 33, refundedMinor: 1000 }) }))).toEqual([
      '$0.33 of the product sales is tax.',
      'Refunds noted today: $10.00. They are not taken off the total above.',
      'The list shows the newest. 3 earlier ones are not listed.',
    ]);
    expect(takingsNotes(page({ salesNotShown: 1 }))).toEqual(['The list shows the newest. 1 earlier one is not listed.']);
    // What was taken in another money is said, never added in.
    expect(takingsNotes(page({ totals: totals({ otherCurrency: 1 }) }))).toEqual([
      '1 sale or payment today was taken in another currency. It is listed below and not added to the total above.',
    ]);
    expect(takingsNotes(page({ totals: totals({ otherCurrency: 4 }) }))).toEqual([
      '4 sales or payments today were taken in another currency. They are listed below and not added to the total above.',
    ]);
  });
  it('product sales and membership payments are one list, newest first, on the gym’s own clock', () => {
    const payment = { id: 'm1', typeName: '1 Month', amountMinor: 4999, currency: 'USD', method: 'card_at_desk', paidAt: '2026-10-12T15:30:00.000Z', by: null, person: { entryId: 'e2', name: 'Omar Diaz' } };
    const rows = takingsRows(page({ sales: [sale(), sale({ id: 's0', soldAt: '2026-10-12T09:00:00.000Z', person: null, by: null, undone: true, canUndo: false })], payments: [payment] }), 'America/Chicago', '12h');
    expect(rows.map((r) => [r.kind, r.title, r.amount, r.facts, r.canUndo, r.undone])).toEqual([
      ['payment', '1 Month (membership)', '$49.99', 'Omar Diaz · Card at the desk · 10:30 AM', false, false],
      ['sale', '2 × Water', '$4.31', 'Maya Patel · Cash · 9:05 AM · by Sam Desk', true, false],
      ['sale', '2 × Water', '$4.31', 'Walk-in · Cash · 4:00 AM', false, true],
    ]);
    expect(takingsRows(page({ sales: [sale()], payments: null }), 'Europe/London', '24h').map((r) => r.facts)).toEqual(['Maya Patel · Cash · 15:05 · by Sam Desk']);
  });
  it('a sale or payment of somebody deleted for good since reads "A deleted member", never Walk-in, and has no page to open', () => {
    const gone = { id: 'm2', typeName: '1 Month', amountMinor: 4999, currency: 'USD', method: 'cash', paidAt: '2026-10-12T15:30:00.000Z', by: null, person: null };
    const rows = takingsRows(
      page({ sales: [sale({ person: null, personDeleted: true, by: null }), sale({ id: 's0', soldAt: '2026-10-12T09:00:00.000Z', person: null, personDeleted: false, by: null })], payments: [gone] }),
      'America/Chicago',
      '12h',
    );
    expect(rows.map((r) => [r.kind, r.facts, r.person])).toEqual([
      ['payment', 'A deleted member · Cash · 10:30 AM', null],
      ['sale', 'A deleted member · Cash · 9:05 AM', null],
      ['sale', 'Walk-in · Cash · 4:00 AM', null],
    ]);
  });
  it('the Undo box says what goes and who gives the money back', () => {
    expect(undoSaleQuestion(sale())).toBe("Undo this sale? 2 × Water, $4.31. It will no longer count in today's total. If you took the money, give it back yourself.");
  });
  it('a purchase on a person’s page', () => {
    expect(purchaseLine(sale())).toEqual({ title: '2 × Water', amount: '$4.31', facts: '12 Oct 2026 · Cash · $0.33 Sales tax', undone: false });
    // A sale made before rates had names says "tax".
    expect(saleTaxWords(sale({ taxName: null }))).toBe('$0.33 tax');
    expect(saleTaxWords(sale({ taxMinor: 0 }))).toBeNull();
    expect(purchaseLine(sale({ taxMinor: 0, method: 'bank_transfer', undone: true }))).toEqual({ title: '2 × Water', amount: '$4.31', facts: '12 Oct 2026 · Bank transfer', undone: true });
  });
});

describe('products and tax', () => {
  it('a form is checked box by box', () => {
    const good = { ...emptyProductDraft(), name: 'Water', price: '1.99' };
    expect(productProblems(good, 'USD')).toEqual({});
    expect(productProblems({ ...good, name: '  ' }, 'USD')).toEqual({ name: 'Give the product a name.' });
    expect(productProblems({ ...good, name: 'x'.repeat(81) }, 'USD')).toEqual({ name: 'Keep the name to 80 characters.' });
    expect(productProblems({ ...good, name: `Water${String.fromCharCode(0x200b)}` }, 'USD')).toEqual({ name: HIDDEN_TEXT });
    expect(productProblems({ ...good, name: `Wa${String.fromCharCode(10)}ter` }, 'USD')).toEqual({ name: HIDDEN_TEXT });
    for (const price of ['', '0', '0.00', '1,99', '1.999', '-1', 'free']) {
      expect(productProblems({ ...good, price }, 'USD')).toEqual({ price: 'Enter the price as a number above 0, like 9.99.' });
    }
    expect(productProblems({ ...good, counts: true, stock: '' }, 'USD')).toEqual({ stock: 'Enter how many you have, from 0 to 100,000.' });
    expect(productProblems({ ...good, counts: true, stock: '2.5' }, 'USD')).toEqual({ stock: 'Enter how many you have, from 0 to 100,000.' });
    expect(productProblems({ ...good, counts: true, stock: '100001' }, 'USD')).toEqual({ stock: 'Enter how many you have, from 0 to 100,000.' });
    expect(productProblems({ ...good, counts: true, stock: '0' }, 'USD')).toEqual({});
  });
  it('the form as the server takes it, new and changed', () => {
    // A new product charges the gym's one rate; with no rate, or several, it starts on No tax.
    expect(productBody({ ...emptyProductDraft(TEXAS), name: ' Water ', price: '1.99' }, 'USD')).toEqual({ name: 'Water', priceMinor: 199, taxRateId: 'r1', stock: null });
    expect(emptyProductDraft(NO_TAX).taxRateId).toBe('');
    expect(emptyProductDraft({ included: false, rates: [rate(), rate({ id: 'r2', name: 'Food tax' })] }).taxRateId).toBe('');
    expect(productBody({ ...emptyProductDraft(NO_TAX), name: 'Water', price: '1.99' }, 'USD').taxRateId).toBeNull();
    const draft = draftFromProduct(water({ stock: 8, taxRateId: null }));
    expect(draft).toEqual({ id: 'p1', name: 'Water', price: '1.99', taxRateId: '', counts: true, stock: '8', updatedAt: '2026-10-12T10:00:00.000Z' });
    expect(productBody({ ...draft, stock: '12' }, 'USD')).toEqual({ name: 'Water', priceMinor: 199, taxRateId: null, stock: 12, updatedAt: '2026-10-12T10:00:00.000Z' });
  });
  it('a product in the list says its price, its tax only where the gym charges one, and its stock', () => {
    expect(productRow(water(), NO_TAX)).toBe('$1.99 · stock not counted');
    expect(productRow(water({ stock: 8 }), TEXAS)).toBe('$1.99 · plus Sales tax 8.25% · 8 in stock');
    expect(productRow(water({ stock: 0, currency: 'GBP' }), UK)).toBe('£1.99 · VAT 20% included · out of stock');
    expect(productRow(water({ taxRateId: null }), TEXAS)).toBe('$1.99 · no tax · stock not counted');
    expect(productRow(water(), NO_TAX, 'USD')).toBe('$1.99 · stock not counted');
    expect(productRow(water(), NO_TAX, 'GBP')).toBe('$1.99 · priced in USD: save its price in GBP to sell it · stock not counted');
  });
  it('a tax rate form', () => {
    expect(emptyRateDraft()).toEqual({ id: null, name: '', rate: '' });
    expect(draftFromRate(rate())).toEqual({ id: 'r1', name: 'Sales tax', rate: '8.25' });
    expect(rateProblems({ name: ' GST ', rate: '18' })).toEqual({});
    expect(rateBody({ name: ' GST ', rate: ' 18 ' })).toEqual({ name: 'GST', bp: 1800 });
    expect(rateBody({ name: 'Sales tax', rate: '8.25' })).toEqual({ name: 'Sales tax', bp: 825 });
    expect(rateProblems({ name: '', rate: '18' })).toEqual({ name: 'Give the tax a name, such as GST, VAT or Sales tax.' });
    expect(rateProblems({ name: 'x'.repeat(31), rate: '18' })).toEqual({ name: 'Keep the name to 30 characters.' });
    expect(rateProblems({ name: `GST${String.fromCharCode(0x200b)}`, rate: '18' })).toEqual({ name: HIDDEN_TEXT });
    for (const typed of ['', '0', '0.00', '8,25', '31', '8.255', '-1', 'ten']) {
      expect(rateProblems({ name: 'GST', rate: typed })).toEqual({ rate: 'Enter the rate as a number above 0 and up to 30, like 8.25.' });
    }
  });
  it('a rate’s Choose box ticks what charges it, says what another one charges now, and says what was saved', () => {
    const page = {
      tax: { included: false, rates: [rate(), rate({ id: 'r2', name: 'VAT', bp: 2000 })] },
      membershipTypes: [
        { id: 't1', name: 'Gold', taxRateId: 'r1' },
        { id: 't2', name: 'Silver', taxRateId: 'r2' },
        { id: 't3', name: 'Bronze', taxRateId: null },
      ],
      products: [water()],
    };
    expect(chargeChoices(page, rate(), 'memberships')).toEqual([
      { id: 't1', name: 'Gold', on: true, note: null },
      { id: 't2', name: 'Silver', on: false, note: 'Now charges VAT 20%' },
      { id: 't3', name: 'Bronze', on: false, note: null },
    ]);
    expect(chargeChoices(page, rate(), 'products')).toEqual([{ id: 'p1', name: 'Water', on: true, note: null }]);
    expect(chargedWords(rate(), ['Gold'], 'memberships')).toBe('Sales tax 8.25% is now charged on Gold.');
    expect(chargedWords(rate(), ['A', 'B', 'C', 'D', 'E'], 'memberships')).toBe('Sales tax 8.25% is now charged on A, B, C and 2 more.');
    expect(chargedWords(rate(), [], 'products')).toBe('Sales tax 8.25% is now charged on no products.');
  });
  it('what a rate is charged on, and why one in use is not removed', () => {
    expect(rateUses(rate())).toBe('Not charged on anything yet.');
    expect(rateRemoveBlock(rate())).toBeNull();
    expect(rateUses(rate({ products: 1 }))).toBe('Charged on 1 product.');
    expect(rateUses(rate({ products: 3, membershipTypes: 1, memberships: 12 }))).toBe("Charged on 3 products, 1 membership type and 12 members' memberships.");
    expect(rateRemoveBlock(rate({ products: 2 }))).toBe("Sales tax can't be removed: it is charged on 2 products. Change those to another rate or No tax first.");
    expect(rateRemoveBlock(rate({ memberships: 1 }))).toBe(
      "Sales tax can't be removed: it is charged on 1 member's membership. A membership keeps the tax it was sold with, so Sales tax can be removed once nobody holds one.",
    );
  });
  it('what the gym’s tax is, in one sentence', () => {
    expect(taxLine(NO_TAX)).toBe('You charge no tax. Add a tax rate if you need to charge one.');
    expect(taxLine(TEXAS)).toBe('Tax is added on top of the price of each product and membership that charges it.');
    expect(taxLine(UK)).toBe('Your prices include the tax. Each sale and each bill shows how much of it is tax.');
  });
  it('the two ways are explained in the gym’s own money, with sums that are true', () => {
    expect(taxModes('GBP').map((m) => [m.value, m.label, m.hint])).toEqual([
      ['added', 'Added on top of the price', 'For example, with a 10% tax, a price of £100.00 costs the customer £110.00. Usual in the United States and Canada.'],
      ['included', 'Already included in the price', 'For example, with a 10% tax, a price of £100.00 costs the customer £100.00, and £9.09 of it is tax. Usual where VAT or GST is charged.'],
    ]);
    // With a rate of its own, the gym reads its own rate, never a made-up 10% (Kd's click-through).
    expect(taxModes('INR', rate({ name: 'GST', bp: 1800 })).map((m) => m.hint)).toEqual([
      'With GST 18%, a price of ₹100.00 costs the customer ₹118.00. Usual in the United States and Canada.',
      'With GST 18%, a price of ₹100.00 costs the customer ₹100.00, and ₹15.25 of it is tax. Usual where VAT or GST is charged.',
    ]);
    // The example's own numbers, by the rule the server uses.
    const ten = [rate({ name: 'Tax', bp: 1000 })];
    expect(saleSummary(water({ priceMinor: 1000 }), 1, { included: false, rates: ten }).totalMinor).toBe(1100);
    expect(saleSummary(water({ priceMinor: 1000 }), 1, { included: true, rates: ten }).lines[1]).toEqual({ label: 'Includes Tax 10%', value: '$0.91' });
  });
});

describe('round one of 18b-iii', () => {
  const r = (over = {}) => ({ id: 'r1', name: 'GST', bp: 1800, products: 0, membershipTypes: 0, memberships: 0, ...over });
  it('a rate’s Change form says whose next bill a new percentage reaches', () => {
    expect(rateChangeNote(r())).toBe('A new rate is charged on sales and bills from now on. Sales and bills already made keep the tax they were made with.');
    expect(rateChangeNote(r({ memberships: 1 }))).toBe(
      "A new rate is charged on sales and bills from now on. Sales and bills already made keep the tax they were made with. The next bill of the 1 member's membership that charges GST changes too.",
    );
    expect(rateChangeNote(r({ memberships: 4 }))).toContain("The next bill of the 4 members' memberships that charge GST changes too.");
  });
  it('a free membership is not offered to charge a rate', () => {
    const page = { tax: { included: false, rates: [r()] }, membershipTypes: [{ id: 't1', name: 'Gold', taxRateId: null, free: false }, { id: 't2', name: 'Free week', taxRateId: null, free: true }], products: [] };
    expect(chargeChoices(page, r(), 'memberships').map((c) => c.name)).toEqual(['Gold']);
  });
});
