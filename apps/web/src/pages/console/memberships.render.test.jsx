// The Memberships page (ROADMAP 23c-i): what a gym sells, on a line of its own in the menu.
//
// THE WORST THING IT COULD DO: staff who may not change prices get the page, and inside it
// the names of the people on the gym's list. So the first tests are that somebody without
// the tick has no line in the menu, and that the address typed by hand tells them so and
// asks the server for nothing.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembershipTypes: vi.fn(),
      // The Bills card under the price list has its own tests (`memberBills.render.test.jsx`).
      getBillSettings: vi.fn(() => new Promise(() => undefined)),
      getMembershipWords: vi.fn(),
      previewMembershipLink: vi.fn(),
      createMembershipType: vi.fn(),
      updateMembershipType: vi.fn(),
      archiveMembershipType: vi.fn(),
      restoreMembershipType: vi.fn(),
    },
  };
});

// The Discounts box under the price list (18b-ii-b) reads the Sell page's discounts.
const register = {
  get: vi.fn(),
  addDiscount: vi.fn(),
  changeDiscount: vi.fn(),
  archiveDiscount: vi.fn(),
  restoreDiscount: vi.fn(),
  addTaxRate: vi.fn(),
  changeTaxRate: vi.fn(),
  removeTaxRate: vi.fn(),
  saveTaxMode: vi.fn(),
  chargeTaxRate: vi.fn(),
};
vi.mock('../../api/registerApi', () => ({ registerService: register }));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Memberships = (await import('./Memberships')).default;
const { readOnlyNote } = await import('./billingView');

const IRON = '11111111-1111-4111-8111-111111111111';
const HARBOUR = '22222222-2222-4222-8222-222222222222';

const gym = (over = {}) => ({
  id: IRON,
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  country: 'US',
  status: 'active',
  staffRole: 'manager',
  isMember: false,
  privileges: [...ROLE_PRIVILEGES.manager],
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: 200 },
  ...over,
});

const type = (over = {}) => ({
  id: '33333333-3333-4333-8333-000000000001',
  name: 'Gold Monthly',
  description: null,
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'USD',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  access: 'all_classes',
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypes: null,
  archivedAt: null,
  updatedAt: '2026-10-04T09:00:00.000Z',
  ...over,
});
const listOf = (over = {}) => ({ currency: 'USD', types: [], archived: [], archivedTotal: 0, classChoices: [], ...over });

/** The page inside the shell, at the address a person opened or typed. */
function draw(orgs, at = '/console/iron-house/memberships') {
  orgService.getMine.mockResolvedValue({ data: { orgs } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <Link to="/console/harbour/memberships">to harbour</Link>
      <Routes>
        <Route path="/console/:orgSlug/memberships" element={<ConsoleLayout><Memberships /></ConsoleLayout>} />
      </Routes>
    </MemoryRouter>,
  );
}

const railLinks = () =>
  [...within(screen.getByTestId('console-rail')).getByRole('navigation', { name: 'Console' }).querySelectorAll('a[href]')].map((a) => a.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type()] }) });
  orgService.getMembershipWords.mockResolvedValue({ data: { words: [], types: [] } });
  register.get.mockImplementation(() => new Promise(() => undefined));
});
afterEach(() => cleanup());

describe('staff who may not change prices', () => {
  const NOT_ALLOWED = "Your role doesn't allow you to see or change memberships and prices. Ask the owner if you need to.";

  it.each([
    ['a trainer', 'trainer', [...ROLE_PRIVILEGES.trainer]],
    ['a manager the owner took the tick from', 'manager', ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage')],
    ['a manager left with every other tick the owner can give', 'manager', [...new Set([...ROLE_PRIVILEGES.owner, ...ROLE_PRIVILEGES.manager])].filter((p) => p !== 'memberships.manage')],
  ])('%s: no Memberships line in the menu, the typed address says so, and nothing is read', async (_who, staffRole, privileges) => {
    draw([gym({ staffRole, privileges })]);
    expect(await screen.findByText(NOT_ALLOWED)).toBeTruthy();
    expect(railLinks()).not.toContain('Memberships');
    expect(within(screen.getByTestId('console-tabbar')).queryByText('Memberships')).toBeNull();
    // Neither the price list nor the names from the member list.
    await new Promise((r) => setTimeout(r, 20));
    expect(orgService.getMembershipTypes).not.toHaveBeenCalled();
    expect(orgService.getMembershipWords).not.toHaveBeenCalled();
    expect(orgService.previewMembershipLink).not.toHaveBeenCalled();
    expect(screen.queryByText('Gold Monthly')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a membership type' })).toBeNull();
  });

  it('an address that is not one of their gyms is said, and nothing is read', async () => {
    draw([gym()], '/console/somebody-elses/memberships');
    expect(await screen.findByText("We couldn't find an organisation you run at this address.")).toBeTruthy();
    expect(orgService.getMembershipTypes).not.toHaveBeenCalled();
    expect(orgService.getMembershipWords).not.toHaveBeenCalled();
  });
});

describe('discounts for memberships (18b-ii-b)', () => {
  const reach = { forProducts: false, allProducts: true, productIds: [], forMemberships: true, allMembershipTypes: true, membershipTypeIds: [] };
  const base = { code: null, kind: 'percent', percentBp: 2000, amountMinor: null, currency: null, startsOn: null, endsOn: null, maxUses: null, uses: 0, archivedAt: null, updatedAt: '2026-10-14T10:00:00.000Z' };
  const FIRST = { ...base, ...reach, id: 'd-first', name: 'First month', code: 'FIRST20', membershipPayments: 'first' };
  const WATER = { ...base, ...reach, id: 'd-water', name: 'Water deal', forProducts: true, forMemberships: false, membershipPayments: null };
  const sellPage = (discounts) => ({
    currency: 'USD',
    today: '2026-10-14',
    tax: { included: false, rates: [] },
    products: [],
    archived: [],
    archivedTotal: 0,
    discounts,
    archivedDiscounts: [],
    archivedDiscountsTotal: 0,
    membershipTypes: [{ id: type().id, name: 'Gold Monthly', taxRateId: null }],
    canSell: true,
    canManage: true,
    sales: [],
    salesNotShown: 0,
    payments: [],
    paymentsNotShown: 0,
    totals: { count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, discountMinor: 0, otherCurrency: 0 },
  });

  it('are made and listed beside the price list: only the ones for memberships, and a new one starts on memberships', async () => {
    register.get.mockResolvedValue(sellPage([FIRST, WATER]));
    draw([gym()]);
    const box = await screen.findByRole('region', { name: 'Discounts' });
    const rows = await within(box).findAllByTestId('discount-row');
    expect(rows.map((r) => r.textContent)).toEqual(['First monthActive20% off · Promo code FIRST20 · All memberships, first payment only · Not used yetChangeArchive']);
    fireEvent.click(within(box).getByRole('button', { name: 'Add a discount' }));
    const form = within(within(box).getByRole('form', { name: 'Add a discount' }));
    expect(form.getByRole('checkbox', { name: 'Products' }).checked).toBe(false);
    expect(form.getByRole('checkbox', { name: 'Memberships' }).checked).toBe(true);
    fireEvent.change(form.getByLabelText('Discount name'), { target: { value: 'Founders' } });
    fireEvent.change(form.getByRole('textbox', { name: 'Percentage off' }), { target: { value: '10' } });
    fireEvent.click(form.getByLabelText('Every payment'));
    const founders = { ...FIRST, id: 'd-founders', name: 'Founders', code: null, percentBp: 1000, membershipPayments: 'every' };
    register.addDiscount.mockResolvedValue(sellPage([FIRST, founders, WATER]));
    fireEvent.click(form.getByRole('button', { name: 'Add discount' }));
    await waitFor(() => expect(register.addDiscount).toHaveBeenCalledTimes(1));
    expect(register.addDiscount.mock.calls[0][1]).toMatchObject({ name: 'Founders', percentBp: 1000, forProducts: false, forMemberships: true, allMembershipTypes: true, membershipPayments: 'every' });
    expect(await within(box).findByText("Founders added. Staff can now choose it when they add a membership on a member's page.")).toBeTruthy();
    expect(within(box).getAllByTestId('discount-row')).toHaveLength(2);
  });

  it('a gym with none is told so in its own words', async () => {
    register.get.mockResolvedValue(sellPage([WATER]));
    draw([gym()]);
    const box = await screen.findByRole('region', { name: 'Discounts' });
    expect(await within(box).findByText('No discounts for memberships yet. Add one to take a percentage or a fixed amount off a membership, with a promo code if you want one.')).toBeTruthy();
  });
});

describe('tax on memberships (18b-iii)', () => {
  const GST = { id: '44444444-4444-4444-8444-000000000001', name: 'GST', bp: 1800 };
  const VAT = { id: '44444444-4444-4444-8444-000000000002', name: 'VAT', bp: 2000 };
  const rateRow = (r, over = {}) => ({ ...r, products: 0, membershipTypes: 1, memberships: 0, ...over });
  const sellPage = (rates) => ({
    currency: 'USD',
    today: '2026-10-14',
    tax: { included: false, rates },
    products: [],
    archived: [],
    archivedTotal: 0,
    discounts: [],
    archivedDiscounts: [],
    archivedDiscountsTotal: 0,
    membershipTypes: [{ id: type().id, name: 'Gold Monthly', taxRateId: null }],
    canSell: true,
    canManage: true,
    sales: [],
    salesNotShown: 0,
    payments: [],
    paymentsNotShown: 0,
    totals: { count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, discountMinor: 0, otherCurrency: 0 },
  });

  it('a taxed type says its tax on its row, and the Tax box is under the price list with the gym’s rates', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type({ taxRateId: GST.id })], taxRates: [GST], taxIncluded: false }) });
    register.get.mockResolvedValue(sellPage([rateRow(GST, { membershipTypes: 1, memberships: 12 })]));
    draw([gym()]);
    expect(await screen.findByText('Plus GST 18% on each payment')).toBeTruthy();
    const box = await screen.findByRole('region', { name: 'Tax' });
    expect(within(box).getAllByTestId('tax-rate-row').map((r) => r.textContent)).toEqual([expect.stringContaining("GST 18%Charged on 1 membership type and 12 members' memberships.")]);
  });

  it('a rate added in the Tax box opens what charges it: Gold Monthly ticked and saved is charged, and its row says so (Kd’s click-through)', async () => {
    register.get.mockResolvedValue(sellPage([]));
    register.addTaxRate.mockResolvedValue(sellPage([rateRow(GST, { membershipTypes: 0 })]));
    register.chargeTaxRate.mockResolvedValue({ ...sellPage([rateRow(GST)]), membershipTypes: [{ id: type().id, name: 'Gold Monthly', taxRateId: GST.id }] });
    draw([gym()]);
    const box = await screen.findByRole('region', { name: 'Tax' });
    fireEvent.click(within(box).getByRole('button', { name: 'Add a tax rate' }));
    const form = within(within(box).getByRole('form', { name: 'Add a tax rate' }));
    fireEvent.change(form.getByLabelText('Tax name'), { target: { value: 'GST' } });
    fireEvent.change(form.getByLabelText('Rate, in percent'), { target: { value: '18' } });
    // The price list is read again once the rate is charged.
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type({ taxRateId: GST.id })], taxRates: [GST], taxIncluded: false }) });
    // Read again after the add, the Sell page has the new rate, as the server answers.
    register.get.mockResolvedValue(sellPage([rateRow(GST, { membershipTypes: 0 })]));
    fireEvent.click(form.getByRole('button', { name: 'Add tax rate' }));
    expect(await within(box).findByText('GST 18% added. Now tick what charges it.')).toBeTruthy();
    const choose = within(within(box).getByRole('group', { name: 'What charges GST 18%' }));
    expect(choose.getByText('Which memberships charge GST 18%?')).toBeTruthy();
    expect(choose.getByText('Members who already hold a membership keep the tax it was sold with. New memberships charge what you tick here.')).toBeTruthy();
    fireEvent.click(choose.getByRole('checkbox', { name: 'Gold Monthly' }));
    fireEvent.click(choose.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(register.chargeTaxRate).toHaveBeenCalledWith(IRON, GST.id, { use: 'memberships', ids: [type().id] }));
    expect(await screen.findByText('GST 18% is now charged on Gold Monthly.')).toBeTruthy();
    expect(await screen.findByText('Plus GST 18% on each payment')).toBeTruthy();
  });

  it('where the gym’s prices hold the tax, the row says the price includes it', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type({ taxRateId: VAT.id })], taxRates: [VAT], taxIncluded: true }) });
    draw([gym()]);
    expect(await screen.findByText('Includes VAT 20%')).toBeTruthy();
  });

  it('the type form picks its tax, a rate added from inside it is picked there at once, and the save sends it', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type({ taxRateId: null })], taxRates: [GST], taxIncluded: false }) });
    register.addTaxRate.mockResolvedValue(sellPage([rateRow(GST), rateRow(VAT, { membershipTypes: 0 })]));
    orgService.updateMembershipType.mockResolvedValue({ data: listOf({ types: [type({ taxRateId: VAT.id })], taxRates: [GST, VAT], taxIncluded: false }) });
    draw([gym()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    const form = within(screen.getByRole('form', { name: 'Change membership type' }));
    const tax = form.getByLabelText('Tax');
    expect(tax.value).toBe('');
    expect([...tax.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['No tax', 'GST 18%']);
    expect(form.getByText('Members who already hold it keep the tax they were sold with.')).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Add a tax rate' }));
    const rate = within(form.getByRole('group', { name: 'Add a tax rate' }));
    fireEvent.change(rate.getByLabelText('Tax name'), { target: { value: 'VAT' } });
    fireEvent.change(rate.getByLabelText('Rate, in percent'), { target: { value: '20' } });
    fireEvent.click(rate.getByRole('button', { name: 'Add tax rate' }));
    await waitFor(() => expect(register.addTaxRate).toHaveBeenCalledWith(IRON, { name: 'VAT', bp: 2000 }));
    await waitFor(() => expect(form.getByLabelText('Tax').value).toBe(VAT.id));
    // Adding the rate saved nothing of the type.
    expect(orgService.updateMembershipType).not.toHaveBeenCalled();
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][2]).toMatchObject({ name: 'Gold Monthly', priceMinor: 4999, taxRateId: VAT.id });
    expect(await screen.findByText('Plus VAT 20% on each payment')).toBeTruthy();
  });

  it('a taxed price too high to bill is said under the price, and nothing is sent', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type({ taxRateId: GST.id })], taxRates: [GST], taxIncluded: false }) });
    draw([gym()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    const form = within(screen.getByRole('form', { name: 'Change membership type' }));
    fireEvent.change(form.getByLabelText('Price (USD)'), { target: { value: '800000' } });
    fireEvent.click(form.getByRole('button', { name: 'Save changes' }));
    expect(await form.findByText('A price with tax can be at most $769,230.76. Lower the price, or choose No tax.')).toBeTruthy();
    expect(orgService.updateMembershipType).not.toHaveBeenCalled();
  });
});

describe('staff who may', () => {
  it.each([
    ['the owner', 'owner', [...ROLE_PRIVILEGES.owner]],
    ['a manager on the usual ticks', 'manager', [...ROLE_PRIVILEGES.manager]],
    ['a trainer the owner gave the tick', 'trainer', [...ROLE_PRIVILEGES.trainer, 'memberships.manage']],
  ])('%s: Memberships is in the menu straight after Members, and the page opens with the price list already open', async (_who, staffRole, privileges) => {
    draw([gym({ staffRole, privileges })]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Memberships' })).toBeTruthy();
    const rail = railLinks();
    // The line above it is the Members page's: "Members & staff" for the owner (23c-ii).
    const members = rail.findIndex((label) => label === 'Members' || label === 'Members & staff');
    expect(members).toBeGreaterThanOrEqual(0);
    expect(rail.indexOf('Memberships')).toBe(members + 1);
    // Nothing to press first: the list, its price and the main button are there.
    expect(await screen.findByText('Gold Monthly')).toBeTruthy();
    expect(screen.getByText('$49.99 every month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(false);
    expect(orgService.getMembershipTypes).toHaveBeenCalledWith(IRON);
  });

  it('on a phone the page is under More, never a fifth tab', async () => {
    draw([gym()]);
    await screen.findByText('Gold Monthly');
    expect(within(screen.getByTestId('console-tabbar')).queryByText('Memberships')).toBeNull();
    // More is lit while the page is open, as for every page reached from it.
    const more = within(screen.getByTestId('console-tabbar')).getByText('More').closest('a');
    expect(more.className).toContain('c-tab-on');
    // Members is not, though its address is the start of this one: on the phone or the computer.
    expect(within(screen.getByTestId('console-tabbar')).getByText('Members').closest('a').className).not.toContain('c-tab-on');
    const rail = within(screen.getByTestId('console-rail'));
    expect(rail.getByText('Members').closest('a').className).not.toContain('c-nav-on');
    expect(rail.getByText('Memberships').closest('a').className).toContain('c-nav-on');
  });

  it('an address that names one membership and a name from the list opens that box, once, and is tidied', async () => {
    // What a button on Members or on the import's last screen leads to (`membershipBoxTo`).
    const Where = () => {
      const at = useLocation();
      return <span data-testid="where">{`${at.pathname}${at.search}`}</span>;
    };
    orgService.getMine.mockResolvedValue({ data: { orgs: [gym()] } });
    orgService.previewMembershipLink.mockResolvedValue({
      data: {
        today: '2026-10-11',
        word: '3 Month Plan',
        type: { id: type().id, name: 'Gold Monthly', kind: 'recurring', priceMinor: 4999, currency: 'USD', termCount: 1, termUnit: 'month', packClasses: null, packDays: null },
        ownName: false,
        digest: 'a'.repeat(64),
        counts: { settled: 1, due: 0, ask: 0, has: 0, full: 0, ended: 0, day: 0, again: 0, past: 0 },
        people: [],
      },
    });
    render(
      <MemoryRouter initialEntries={[`/console/iron-house/memberships?give=${type().id}&name=3%20Month%20Plan`]}>
        <Where />
        <Routes>
          <Route path="/console/:orgSlug/memberships" element={<ConsoleLayout><Memberships /></ConsoleLayout>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(orgService.previewMembershipLink).toHaveBeenCalledWith(IRON, { word: '3 Month Plan', typeId: type().id }));
    expect(await screen.findByRole('group', { name: 'Give Gold Monthly to the people with “3 Month Plan” on your member list?' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/console/iron-house/memberships'));
    expect(orgService.previewMembershipLink).toHaveBeenCalledTimes(1);
  });

  it('a gym with no live plan still sees its list, is told why nothing can be changed, and its buttons are off', async () => {
    draw([gym({ consoleReadOnly: true })]);
    expect(await screen.findByText('Gold Monthly')).toBeTruthy();
    expect(screen.getByText(readOnlyNote('gym'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Change Gold Monthly' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Archive Gold Monthly' }).disabled).toBe(true);
  });

  it('a gym with no country: the owner gets a button to the country box in Settings, and somebody who cannot change the details is told to ask', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ currency: null }) });
    draw([gym({ staffRole: 'owner', privileges: [...ROLE_PRIVILEGES.owner] })]);
    expect(await screen.findByText("Set your country in Gym details before adding a membership type. Prices are in your country's own money.")).toBeTruthy();
    // Settings with Gym details open, at the country box (23d): not Settings with every box closed.
    expect(screen.getByRole('link', { name: 'Set your country' }).getAttribute('href')).toBe('/console/iron-house/settings#country');
    cleanup();
    resetConsoleOrgs();
    draw([gym()]);
    expect(await screen.findByText(/Ask the owner to set it in Gym details./)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Set your country' })).toBeNull();
    // A studio's section has the studio's name, as Settings writes it.
    cleanup();
    resetConsoleOrgs();
    draw([gym({ orgType: 'studio' })]);
    expect(await screen.findByText(/Ask the owner to set it in Studio details./)).toBeTruthy();
  });

  it("moving to another gym throws away what was typed for the first, and reads the second gym's own list", async () => {
    orgService.getMembershipTypes.mockImplementation((gymId) =>
      Promise.resolve({ data: listOf({ types: [type({ name: gymId === IRON ? 'Gold Monthly' : 'Harbour Pass' })] }) }),
    );
    draw([gym(), gym({ id: HARBOUR, slug: 'harbour', name: 'Harbour Gym' })]);
    await screen.findByText('Gold Monthly');
    fireEvent.click(screen.getByRole('button', { name: 'Add a membership type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Typed for Iron House' } });

    fireEvent.click(screen.getByText('to harbour'));
    expect(await screen.findByText('Harbour Pass')).toBeTruthy();
    expect(screen.queryByText('Gold Monthly')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByDisplayValue('Typed for Iron House')).toBeNull();
    await waitFor(() => expect(orgService.getMembershipTypes).toHaveBeenCalledWith(HARBOUR));
    expect(orgService.createMembershipType).not.toHaveBeenCalled();
  });
});
