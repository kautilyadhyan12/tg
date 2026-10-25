// Settings → Payments (ROADMAP 18d-i), for the gym's own owner and for everybody else.
//
// The worst thing this box could do is let somebody other than the gym's owner connect a
// Square account, or say "Connected" about one that is not. So the button is the owner's
// alone, every state says plainly what is connected, and Disconnect asks first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getGymPayments: vi.fn(), connectSquare: vi.fn(), chooseSquareLocation: vi.fn(), disconnectSquare: vi.fn(), getSquareAppCheck: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const PaymentsPanel = (await import('./PaymentsPanel')).default;
const { readOnlyNote } = await import('../../pages/console/billingView');

const ORG = { id: '11111111-1111-4111-8111-111111111111', slug: 'iron-house', name: 'Iron House', orgType: 'gym', country: 'GB', timezone: 'Europe/London' };
const payments = (over = {}) => ({ availability: 'square', country: 'GB', canConnect: true, squareReady: true, square: null, ...over });
const CONNECTED = { state: 'connected', businessName: 'Iron House Ltd', locationName: 'Leeds', locations: [], connectedAt: '2026-10-19T09:30:00.000Z', removedAt: null };

const assign = vi.fn();

function open(data, { readOnly = false, outcome = null, org = ORG } = {}) {
  orgService.getGymPayments.mockResolvedValue({ data: { payments: data } });
  render(
    <MemoryRouter>
      <PaymentsPanel org={org} readOnly={readOnly} outcome={outcome} countryTo="/console/iron-house/settings#country" openSquare={assign} />
    </MemoryRouter>,
  );
  if (outcome === null) fireEvent.click(screen.getByRole('button', { name: /^payments/i }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe('a gym in a country Square serves, not connected', () => {
  it("the owner reads what Square does and what it costs, and Connect Square opens Square's own page in this tab", async () => {
    open(payments());
    expect(await screen.findByText('Not connected')).toBeTruthy();
    expect(screen.getByText('Connect Square for member payments')).toBeTruthy();
    expect(screen.getByText('Accept payments from your members through Square. Payments are deposited directly into your bank account, and Square applies its standard processing fees.')).toBeTruthy();
    expect(screen.getByText('No additional fees from us.')).toBeTruthy();
    expect(screen.getByText("Don't have a Square account? You can create one for free when you connect Square.")).toBeTruthy();
    orgService.connectSquare.mockResolvedValue({ data: { url: 'https://connect.squareupsandbox.com/oauth2/authorize?state=abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Square' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.squareupsandbox.com/oauth2/authorize?state=abc'));
    expect(orgService.connectSquare).toHaveBeenCalledWith(ORG.id);
    // The way back to this box, if the return fails.
    expect(window.sessionStorage.getItem('squareConnectGym')).toBe('iron-house');
  });

  it('anybody else reads it, with no button, and the line says who can', async () => {
    open(payments({ canConnect: false }));
    expect(await screen.findByText('Only the owner of Iron House can connect Square.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect square/i })).toBeNull();
  });

  it("a press the server refuses says so in the box, and Square's page is not opened", async () => {
    open(payments());
    orgService.connectSquare.mockRejectedValue({ response: { status: 409, data: { error: 'square_already_connected', message: 'Square is already connected.' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Square' }));
    expect(await screen.findByText('Square is already connected.')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("a gym whose plan has ended can't connect, and is told why", async () => {
    open(payments(), { readOnly: true });
    const button = await screen.findByRole('button', { name: 'Connect Square' });
    expect(button.disabled).toBe(true);
    expect(screen.getByText(readOnlyNote('gym'))).toBeTruthy();
  });
});

describe('a gym Square does not serve', () => {
  it.each([
    ['India', payments({ availability: 'india_soon', country: 'IN' }), 'Card and UPI payments for gyms in India are coming soon. Until then, record the payments you take at the desk on each person\'s page.', 'Coming soon in India'],
    ['Germany', payments({ availability: 'not_available', country: 'DE' }), "Card payments aren't available for gyms in Germany yet. Until then, record the payments you take at the desk on each person's page.", 'Not available in Germany yet'],
  ])('%s: one line, and no button', async (_where, data, line, summary) => {
    open(data);
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.getByText(summary)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect square/i })).toBeNull();
  });

  it('no country yet: a link to the exact place to add it', async () => {
    open(payments({ availability: 'no_country', country: null }));
    expect(await screen.findByText('Choose your country first. The card payments you can take depend on where you are.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose your country' }).getAttribute('href')).toBe('/console/iron-house/settings#country');
  });
});

describe('connected', () => {
  it('names the business, its location and the day, and Disconnect asks first', async () => {
    open(payments({ square: CONNECTED }));
    expect(await screen.findByText('Connected to Square · Iron House Ltd')).toBeTruthy();
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual(['Business', 'Location', 'Connected']);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual(['Iron House Ltd', 'Leeds', '19 Oct 2026']);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Square' }));
    const ask = screen.getByRole('group', { name: 'Disconnect Square?' });
    expect(within(ask).getByText("Iron House stops using Iron House Ltd's Square account.")).toBeTruthy();
    expect(within(ask).getByText('Your Square account and its money stay as they are, and you can connect it again at any time.')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep connected' }));
    expect(screen.queryByRole('group', { name: 'Disconnect Square?' })).toBeNull();
    expect(orgService.disconnectSquare).not.toHaveBeenCalled();

    orgService.disconnectSquare.mockResolvedValue({ data: { payments: payments() } });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Square' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Disconnect Square?' })).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Square is disconnected.')).toBeTruthy();
    expect(orgService.disconnectSquare).toHaveBeenCalledWith(ORG.id);
    expect(screen.getByRole('button', { name: 'Connect Square' })).toBeTruthy();
  });

  it('a lapsed gym can still disconnect', async () => {
    open(payments({ square: CONNECTED }), { readOnly: true });
    expect((await screen.findByRole('button', { name: 'Disconnect Square' })).disabled).toBe(false);
  });

  it('anybody else reads it, and cannot disconnect', async () => {
    open(payments({ canConnect: false, square: CONNECTED }));
    expect(await screen.findByText('Only the owner of Iron House can disconnect Square.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect Square' })).toBeNull();
  });
});

describe("Square Point of Sale (18d-iii-b-i): a checklist a gym that opened last week can follow, in Kd's words", () => {
  const BOX = { name: 'Square Point of Sale' };
  const checked = (taxes, over = {}) => ({ data: { check: { taxes, currency: 'USD', membershipTax: true, canSetTax: true, ...over } } });
  const SALES_TAX = { state: 'adds', taxes: [{ name: 'Sales Tax', percentage: '8.25' }], exampleMinor: 4500, chargedMinor: 4871 };
  const step = (box, id) => within(box.getByTestId(id));
  // A sentence found whole by what it says, whatever is drawn in its own colour or in bold inside it.
  const said = (scope, text) => scope.getByText((_, el) => el !== null && el.tagName === 'SPAN' && el.textContent === text && [...el.children].every((c) => c.textContent !== text));
  // A label on a screen, drawn in its own colour and nothing more.
  const label = (line, text) => within(line).getByText(text, { selector: '.c-ui' });

  it('says what it is apart from the Terminal, and says Done beside each line that is done', async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'none' }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(box.getByText("Use the Square Point of Sale app on a phone or tablet with a Square Reader. Start the payment in the Square app. When the amount is exactly what the bill says, it will appear on the member's bill here afterwards.")).toBeTruthy();
    expect(box.getByText('To make this work:')).toBeTruthy();
    expect(await box.findByText('Square does not add tax to the amount you enter')).toBeTruthy();
    const tax = step(box, 'square-tax-step');
    expect(tax.getByText('The member pays exactly what the bill says.')).toBeTruthy();
    expect(tax.getByText('Done')).toBeTruthy();
    expect(step(box, 'square-member-tax-step').getByText('Tax on memberships is set here')).toBeTruthy();
    const pick = step(box, 'square-pick-step');
    expect(pick.getByText('Select the member for every sale')).toBeTruthy();
    label(said(pick, 'In Square Point of Sale, tap Add a customer and select the member before taking payment.'), 'Add a customer');
    // Picking is up to staff, and what skipping it means is said where it is asked.
    expect(pick.getByText('Square allows staff to skip this step. If no member is selected, the payment will not be applied to the bill automatically, and you will need to record it manually.')).toBeTruthy();
    // The setting that gives staff the button, only when asked for; Square is never said to ask by itself.
    expect(box.queryByText(/Before checkout/)).toBeNull();
    expect(box.queryByText(/ask every time/)).toBeNull();
    fireEvent.click(pick.getByRole('button', { name: "Can't find Add a customer?" }));
    const path = said(pick, 'In Square Point of Sale: More → Settings → Checkout → Customer management.');
    for (const name of ['More', 'Settings', 'Checkout', 'Customer management']) label(path, name);
    const setting = said(pick, 'Enable customer management. Then, under Collect customer information, turn on Before checkout.');
    label(setting, 'Collect customer information');
    label(setting, 'Before checkout');
    // Who it works for, said plainly: everybody else is charged as usual, and recorded by hand.
    // Only an exact amount goes on by itself, and one that does not appear is recorded by hand (review round one).
    expect(box.getByText('For members who have a card on file here, the payment will be applied to their bill automatically when they are selected as the customer and the amount is exactly what the bill says.')).toBeTruthy();
    expect(box.getByText("If a payment does not appear on the member's bill a few minutes after it was taken, record it there the same way.")).toBeTruthy();
    expect(box.queryByText(/will appear on the member's bill here afterwards\.$/)).toBeTruthy();
    expect(box.queryByText(/^Start the payment in the Square app, and it will appear/)).toBeNull();
    const others = said(box, 'For anyone else, or for a sale where no member is selected, Square will process the payment as usual. Then open their bill here, click Record payment, and select Card at the desk.');
    label(others, 'Record payment');
    label(others, 'Card at the desk');
    expect(box.getByText('Shop items sold from your Square item list are never added to a bill.')).toBeTruthy();
    expect(orgService.getSquareAppCheck).toHaveBeenCalledWith(ORG.id);
  });

  it("Square adds tax: Needs fixing, what it does to a $45.00 bill in bold, then the two steps at once with Square's labels in their own colour, and Check again", async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked(SALES_TAX, { membershipTax: false }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    const tax = within(await box.findByTestId('square-tax-step'));
    expect(await tax.findByText('Square adds tax to the amount you enter')).toBeTruthy();
    expect(tax.getByText('Needs fixing')).toBeTruthy();
    const what = said(tax, 'Square adds Sales Tax (8.25%) to manually entered amounts. For a $45.00 bill, the member would be charged $48.71.');
    for (const value of ['Sales Tax (8.25%)', '$45.00', '$48.71']) expect(within(what).getByText(value, { selector: 'strong' })).toBeTruthy();
    expect(tax.getByText("This does not match the bill total, so the payment will not be applied to the member's bill. If the bill already includes tax, the member will be charged tax twice.")).toBeTruthy();
    // Something is wrong, so the steps are open, not hidden behind a press.
    expect(tax.getByRole('button', { name: 'Hide the steps' }).getAttribute('aria-expanded')).toBe('true');
    const inSquare = within(tax.getByTestId('square-fix-in-square'));
    expect(inSquare.getByText("1. Turn off Square's tax on manually entered amounts")).toBeTruthy();
    expect(inSquare.getByText('Membership bills are charged in Square using manually entered amounts, and each bill already includes the tax configured here.')).toBeTruthy();
    const website = said(inSquare, 'On the Square website: Settings → Account & Settings → Payments → Sales taxes.');
    for (const name of ['Settings', 'Account & Settings', 'Payments', 'Sales taxes']) label(website, name);
    const open1 = said(inSquare, 'Open Sales Tax. Turn off Apply tax to custom amounts, then click Save in the top-right corner.');
    for (const name of ['Sales Tax', 'Apply tax to custom amounts', 'Save']) label(open1, name);
    const app = said(inSquare, 'OR, in the Square Point of Sale app: More → Settings → Checkout → Sales taxes.');
    for (const name of ['More', 'Settings', 'Checkout', 'Sales taxes']) label(app, name);
    const tap = said(inSquare, 'Tap Sales Tax and turn off Custom amounts.');
    label(tap, 'Sales Tax');
    label(tap, 'Custom amounts');
    // Disable tax, beside the tax on Square's page, would take the tax off shop items too.
    label(said(inSquare, 'Tax will still apply to items sold from your Square item list. Do not select Disable tax, as this would remove tax from those items too.'), 'Disable tax');
    // The tax set here is the fix's second step, with the button that opens the exact place, and no line of its own too.
    const here = within(tax.getByTestId('square-fix-here'));
    expect(here.getByText('2. Set the same tax for your memberships here')).toBeTruthy();
    expect(here.getByText('This ensures that each bill includes the tax and the member pays it only once.')).toBeTruthy();
    expect(here.getByRole('link', { name: 'Set tax on memberships' }).getAttribute('href')).toBe('/console/iron-house/memberships#tax');
    expect(box.queryByTestId('square-member-tax-step')).toBeNull();
    // Hide the steps, and they come back with How to fix.
    fireEvent.click(tax.getByRole('button', { name: 'Hide the steps' }));
    expect(tax.queryByTestId('square-fix-in-square')).toBeNull();
    fireEvent.click(tax.getByRole('button', { name: 'How to fix' }));
    expect(tax.getByTestId('square-fix-in-square')).toBeTruthy();
    // Fixed in Square: Check again reads it once more, the line turns done and tax on memberships is a line of its own.
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'none' }, { membershipTax: false }));
    fireEvent.click(tax.getByRole('button', { name: 'Check again' }));
    expect(await box.findByText('Square does not add tax to the amount you enter')).toBeTruthy();
    expect(box.queryByText('Needs fixing')).toBeNull();
    const member = step(box, 'square-member-tax-step');
    expect(member.getByText('Tax on memberships: not set here')).toBeTruthy();
    expect(member.getByText('If you charge tax on memberships, set it here, not in Square.')).toBeTruthy();
    expect(member.getByRole('link', { name: 'Set tax on memberships' }).getAttribute('href')).toBe('/console/iron-house/memberships#tax');
    expect(orgService.getSquareAppCheck).toHaveBeenCalledTimes(2);
  });

  it('tax already set here: the second step says to check the rate matches, with the way there', async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked(SALES_TAX));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const here = within(await within(await screen.findByRole('region', BOX)).findByTestId('square-fix-here'));
    expect(here.getByText('Tax on memberships is already set here. Check that it is the same rate as in Square.')).toBeTruthy();
    expect(here.getByRole('link', { name: 'See tax on memberships' }).getAttribute('href')).toBe('/console/iron-house/memberships#tax');
  });

  it('two taxes: each named in bold, both added to the example, and each tax to open', async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked({ ...SALES_TAX, taxes: [{ name: 'Sales Tax', percentage: '8.25' }, { name: 'SALES TAX 2', percentage: '9.0' }], chargedMinor: 5276 }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const tax = within(await within(await screen.findByRole('region', BOX)).findByTestId('square-tax-step'));
    await tax.findByText('Square adds tax to the amount you enter');
    const what = said(tax, 'Square adds Sales Tax (8.25%) and SALES TAX 2 (9.0%) to manually entered amounts. For a $45.00 bill, the member would be charged $52.76.');
    for (const value of ['Sales Tax (8.25%)', 'SALES TAX 2 (9.0%)', '$52.76']) expect(within(what).getByText(value, { selector: 'strong' })).toBeTruthy();
    const open2 = said(tax, 'Open each tax, Sales Tax and SALES TAX 2. Turn off Apply tax to custom amounts, then click Save in the top-right corner.');
    label(open2, 'Sales Tax');
    label(open2, 'SALES TAX 2');
    label(said(tax, 'Tap each tax, Sales Tax and SALES TAX 2, and turn off Custom amounts.'), 'SALES TAX 2');
  });

  it('staff who cannot set prices are told who can, with no button', async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'none' }, { membershipTax: false, canSetTax: false }));
    open(payments({ canConnect: false, square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    const member = within(await box.findByTestId('square-member-tax-step'));
    expect(member.getByText('The owner, or a manager who can change prices, can set it in Memberships.')).toBeTruthy();
    expect(member.queryByRole('link')).toBeNull();
    cleanup();
    orgService.getSquareAppCheck.mockResolvedValue(checked(SALES_TAX, { membershipTax: false, canSetTax: false }));
    open(payments({ canConnect: false, square: CONNECTED, squareApp: { needsAllow: false } }));
    const here = within(await within(await screen.findByRole('region', BOX)).findByTestId('square-fix-here'));
    expect(here.getByText('The owner, or a manager who can change prices, can set it in Memberships.')).toBeTruthy();
    expect(here.queryByRole('link')).toBeNull();
  });

  it("Square can't be asked: says so, with Check again, never that it adds none", async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'unknown' }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(await box.findByText("Couldn't check Square's tax settings")).toBeTruthy();
    expect(box.getByText("Square didn't answer just now.")).toBeTruthy();
    expect(box.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(box.queryByText('Square does not add tax to the amount you enter')).toBeNull();
    cleanup();
    orgService.getSquareAppCheck.mockRejectedValue(new Error('offline'));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    expect(await within(await screen.findByRole('region', BOX)).findByText("Couldn't check Square's tax settings")).toBeTruthy();
  });

  it('connected before Square let the app read what it needs: the owner reconnects, everybody else is told who can', async () => {
    open(payments({ square: CONNECTED, squareApp: { needsAllow: true } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(box.getByText('Square needs your permission first')).toBeTruthy();
    expect(box.getByText('Needs fixing')).toBeTruthy();
    const line = said(box, "Press Reconnect Square, then Allow on Square's page. Nothing else changes.");
    label(line, 'Reconnect Square');
    label(line, 'Allow');
    expect(orgService.getSquareAppCheck).not.toHaveBeenCalled();
    orgService.connectSquare.mockResolvedValue({ data: { url: 'https://connect.squareupsandbox.com/oauth2/authorize?state=again' } });
    fireEvent.click(box.getByRole('button', { name: 'Reconnect Square' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.squareupsandbox.com/oauth2/authorize?state=again'));
    cleanup();
    open(payments({ canConnect: false, square: CONNECTED, squareApp: { needsAllow: true } }));
    const other = within(await screen.findByRole('region', BOX));
    expect(other.getByText('The owner of Iron House needs to reconnect Square first.')).toBeTruthy();
    expect(other.queryByRole('button')).toBeNull();
  });
});

describe('a Square account with several locations', () => {
  const choosing = { ...CONNECTED, state: 'choose_location', locationName: null, locations: [{ id: 'LLEEDS', name: 'Leeds' }, { id: 'LYORK', name: 'York' }] };

  it('the owner who connected the wrong account can disconnect it without picking, on a lapsed plan too', async () => {
    open(payments({ square: choosing }), { readOnly: true });
    expect((await screen.findByRole('button', { name: 'Use this location' })).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Disconnect Square' }).disabled).toBe(false);
  });

  it('the owner picks one; nothing is saved until Use this location', async () => {
    open(payments({ square: choosing }));
    expect(await screen.findByText("Which of this Square account's locations is Iron House?")).toBeTruthy();
    const use = screen.getByRole('button', { name: 'Use this location' });
    expect(use.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'York' }));
    expect(orgService.chooseSquareLocation).not.toHaveBeenCalled();
    orgService.chooseSquareLocation.mockResolvedValue({ data: { payments: payments({ square: { ...CONNECTED, locationName: 'York' } }) } });
    fireEvent.click(use);
    expect(await screen.findByText("York is set as Iron House's Square location.")).toBeTruthy();
    expect(orgService.chooseSquareLocation).toHaveBeenCalledWith(ORG.id, 'LYORK');
  });

  it('anybody else is told the owner still has to choose', async () => {
    open(payments({ canConnect: false, square: { ...choosing, locations: [] } }));
    expect(await screen.findByText('The owner of Iron House still needs to choose which Square location this is.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('the connection ended (taken off inside Square, or a key the server no longer has)', () => {
  it('says so with the day, and offers Connect Square again to the owner alone', async () => {
    const removed = { ...CONNECTED, state: 'removed', removedAt: '2026-10-21T12:00:00.000Z' };
    open(payments({ square: removed }));
    expect(await screen.findByText("The connection to Iron House Ltd's Square account ended on 21 Oct 2026.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Square again' })).toBeTruthy();
    cleanup();
    open(payments({ canConnect: false, square: removed }));
    expect(await screen.findByText('Only the owner of Iron House can connect Square again.')).toBeTruthy();
  });
});

describe("what Square's answer says, back in the box", () => {
  it.each([
    [{ outcome: 'connected', refusal: null }, payments({ square: CONNECTED }), 'Square is connected.'],
    [{ outcome: 'connected_again', refusal: null }, payments({ square: CONNECTED }), 'Square is reconnected.'],
    [{ outcome: 'cancelled', refusal: null }, payments(), "Square wasn't connected: Allow wasn't pressed on Square's page."],
    [{ outcome: 'refused', refusal: { reason: 'other_account', squareCountry: null, squareCurrency: null } }, payments({ square: CONNECTED }), "That Square account isn't the one connected to Iron House. Sign in to the connected account, then reconnect."],
    [{ outcome: 'refused', refusal: { reason: 'wrong_country', squareCountry: 'US', squareCurrency: 'USD' } }, payments(), 'That Square account is in United States, and Iron House is in United Kingdom. Connect the Square account you use in United Kingdom.'],
    [{ outcome: 'refused', refusal: { reason: 'no_card_location', squareCountry: null, squareCurrency: null } }, payments(), 'That Square account has no location that can take card payments yet. Finish setting it up in Square, then press Connect Square again.'],
    [{ outcome: 'refused', refusal: { reason: 'square_unavailable', squareCountry: null, squareCurrency: null } }, payments(), "Square didn't answer. Press Connect Square to try again in a minute."],
  ])('%o', async (outcome, data, line) => {
    open(data, { outcome });
    expect((await screen.findByRole('status')).textContent).toBe(line);
  });
});

describe('a connection is shown before anything about the country', () => {
  it.each([
    ['Germany', payments({ availability: 'not_available', country: 'DE', square: CONNECTED })],
    ['India', payments({ availability: 'india_soon', country: 'IN', square: CONNECTED })],
    ['no country', payments({ availability: 'no_country', country: null, square: CONNECTED })],
  ])('%s: the connection, its rows and Disconnect, never "not available"', async (_where, data) => {
    open(data);
    expect(await screen.findByText('Connected to Square')).toBeTruthy();
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual(['Iron House Ltd', 'Leeds', '19 Oct 2026']);
    expect(screen.getByRole('button', { name: 'Disconnect Square' })).toBeTruthy();
    expect(screen.queryByText(/aren't available|coming soon|Choose your country first/)).toBeNull();
  });
});

describe('a server with no Square keys', () => {
  it('says so, with no button', async () => {
    open(payments({ squareReady: false }));
    expect(await screen.findByText("Square can't be connected on this server yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /connect square/i })).toBeNull();
  });
});
