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

describe("payments taken in Square Point of Sale (18d-iii-b-i)", () => {
  const BOX = { name: "Payments taken in Square Point of Sale" };
  const checked = (taxes, over = {}) => ({ data: { check: { taxes, currency: 'USD', membershipTax: true, canSetTax: true, ...over } } });
  const SALES_TAX = { state: 'adds', taxes: [{ name: 'Sales tax', percentage: '8.25' }], exampleMinor: 4500, chargedMinor: 4871 };

  it("says how to set up Square Point of Sale, and that Square adds no tax of its own where it adds none", async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'none' }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(box.getByText(/add the person as the customer, it's recorded on the person's bill here, as long as the amount is exactly what the bill says/)).toBeTruthy();
    expect(box.getByText('Set up Square Point of Sale once:')).toBeTruthy();
    expect(box.getByText(/^Open More → Settings → Checkout\. Turn on Customer management, then turn on Before checkout/)).toBeTruthy();
    // Where the tax comes from, so nobody reads it as "no tax".
    expect(await box.findByText("Square adds no tax of its own to amounts staff type in. Any tax is already in the bill here, so the member pays exactly the bill's total.")).toBeTruthy();
    expect(box.queryByText(/None of your memberships has tax set here/)).toBeNull();
    expect(box.getByText('Ring up shop items from your item list in Square. Item sales are never added to a bill.')).toBeTruthy();
    expect(orgService.getSquareAppCheck).toHaveBeenCalledWith(ORG.id);
  });

  it('no membership has tax here: says so, with the button to the exact place, or who can for staff who cannot', async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'none' }, { membershipTax: false }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(await box.findByText("None of your memberships has tax set here. If you charge tax on memberships, add it here so it's in each bill.")).toBeTruthy();
    expect(box.getByRole('link', { name: 'Add tax to memberships' }).getAttribute('href')).toBe('/console/iron-house/memberships#tax');
    cleanup();
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'none' }, { membershipTax: false, canSetTax: false }));
    open(payments({ canConnect: false, square: CONNECTED, squareApp: { needsAllow: false } }));
    const theirs = within(await screen.findByRole('region', BOX));
    expect(await theirs.findByText('The owner, or a manager who can change prices, adds tax to memberships in Memberships.')).toBeTruthy();
    expect(theirs.queryByRole('link', { name: 'Add tax to memberships' })).toBeNull();
  });

  it('Square adds sales tax to typed amounts: names it, shows what a $45.00 bill is charged, and says the three things to do', async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked(SALES_TAX, { membershipTax: false }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(await box.findByText('Square adds Sales tax (8.25%) on top of any amount staff type in.')).toBeTruthy();
    expect(
      box.getByText(
        "For example, a member's bill here is $45.00. Staff type $45.00 in Square Point of Sale, and Square charges $48.71. That isn't the bill's amount, so the payment isn't recorded on the bill. And if the bill already includes tax, the member pays tax twice.",
      ),
    ).toBeTruthy();
    expect(box.getByText('In Square Point of Sale, open More → Settings → Checkout → Sales taxes, open the tax and turn off Custom amounts.')).toBeTruthy();
    expect(box.getByText('Put the same tax on your memberships here, so each bill already includes it.')).toBeTruthy();
    expect(box.getByRole('link', { name: 'Add tax to memberships' }).getAttribute('href')).toBe('/console/iron-house/memberships#tax');
    expect(box.getByText('Ring up taxable shop items from your item list in Square, so Square still adds their tax.')).toBeTruthy();
    // Fixed in Square, Check again reads it once more.
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'none' }));
    fireEvent.click(box.getByRole('button', { name: 'Check again' }));
    expect(await box.findByText(/^Square adds no tax of its own/)).toBeTruthy();
    expect(orgService.getSquareAppCheck).toHaveBeenCalledTimes(2);
  });

  it('two taxes: both named, and "each of these taxes"', async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked({ ...SALES_TAX, taxes: [{ name: 'GST', percentage: '5' }, { name: 'PST', percentage: '7' }], chargedMinor: 5040 }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(await box.findByText('Square adds GST (5%) and PST (7%) on top of any amount staff type in.')).toBeTruthy();
    expect(box.getByText(/open each of these taxes and turn off Custom amounts/)).toBeTruthy();
  });

  it("Square can't be asked: says so, with Check again, never that it adds none", async () => {
    orgService.getSquareAppCheck.mockResolvedValue(checked({ state: 'unknown' }));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(await box.findByText("We couldn't read your tax settings from Square just now.")).toBeTruthy();
    expect(box.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(box.queryByText(/^Square adds no tax/)).toBeNull();
    cleanup();
    orgService.getSquareAppCheck.mockRejectedValue(new Error('offline'));
    open(payments({ square: CONNECTED, squareApp: { needsAllow: false } }));
    expect(await within(await screen.findByRole('region', BOX)).findByText("We couldn't read your tax settings from Square just now.")).toBeTruthy();
  });

  it('connected before Square let the app read what it needs: the owner reconnects, everybody else is told who can', async () => {
    open(payments({ square: CONNECTED, squareApp: { needsAllow: true } }));
    const box = within(await screen.findByRole('region', BOX));
    expect(box.getByText('To record payments taken in Square Point of Sale, our app needs your permission in Square.')).toBeTruthy();
    expect(orgService.getSquareAppCheck).not.toHaveBeenCalled();
    orgService.connectSquare.mockResolvedValue({ data: { url: 'https://connect.squareupsandbox.com/oauth2/authorize?state=again' } });
    fireEvent.click(box.getByRole('button', { name: 'Reconnect Square' }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.squareupsandbox.com/oauth2/authorize?state=again'));
    cleanup();
    open(payments({ canConnect: false, square: CONNECTED, squareApp: { needsAllow: true } }));
    const other = within(await screen.findByRole('region', BOX));
    expect(other.getByText('The owner of Iron House needs to reconnect Square before payments taken in Square Point of Sale can be recorded.')).toBeTruthy();
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
