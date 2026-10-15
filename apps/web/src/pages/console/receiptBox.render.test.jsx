// A RECEIPT, OPENED UNDER THE ROW WHOSE BUTTON WAS PRESSED (ROADMAP 18g-i). Only the network
// is mocked: the box reads the receipt by its number, prints that receipt alone, and asks a
// gym with no address for it, typed by whoever may add it and named to whoever may not.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const svc = { purchases: vi.fn(), receipt: vi.fn() };
vi.mock('../../api/registerApi', () => ({ registerService: svc }));
const printHtml = vi.fn();
vi.mock('../../components/console/receiptPrint', () => ({ printHtml }));
const updateOrg = vi.fn();
vi.mock('../../api/orgsApi', async (original) => ({ ...(await original()), orgService: { updateOrg } }));
// The console reads its gyms again after a save; that read is not this box's.
vi.mock('./consoleOrgs', async (original) => ({ ...(await original()), refreshConsoleOrgsAfterChange: () => undefined }));

const MemberPurchases = (await import('./MemberPurchases')).default;

const OWNER = { id: 'g1', slug: 'iron-house', orgType: 'gym', staffRole: 'owner', privileges: ['members.confirm', 'billing.members', 'org.manage'] };
const DESK = { id: 'g1', slug: 'iron-house', orgType: 'gym', staffRole: 'trainer', privileges: ['members.read', 'billing.members'] };
const sale = (over = {}) => ({
  id: 's1',
  itemName: 'Water',
  quantity: 2,
  unitPriceMinor: 250,
  netMinor: 400,
  taxMinor: 33,
  totalMinor: 433,
  taxBp: 825,
  taxName: 'Sales tax',
  taxIncluded: false,
  discountName: 'Staff 20',
  discountMinor: 100,
  currency: 'USD',
  method: 'cash',
  soldOn: '2026-10-15',
  soldAt: '2026-10-15T14:05:00.000Z',
  by: 'Sam Desk',
  person: { entryId: 'e1', name: 'Maya Patel' },
  undone: false,
  voided: null,
  canUndo: true,
  receiptNumber: 7,
  ...over,
});
const receipt = (over = {}) => ({
  kind: 'sale',
  number: 7,
  gym: { name: 'Iron House', address: '12 High Street\nAustin TX 78701' },
  on: '2026-10-15',
  person: 'Maya Patel',
  personDeleted: false,
  by: 'Sam Desk',
  currency: 'USD',
  cancelled: false,
  item: { name: 'Water', quantity: 2, unitPriceMinor: 250 },
  amounts: { listedMinor: 500, discount: { name: 'Staff 20', minor: 100 }, tax: { name: 'Sales tax', bp: 825, included: false, minor: 33 }, totalMinor: 433 },
  method: 'cash',
  ...over,
});

const open = (gym = OWNER) =>
  render(
    <MemoryRouter>
      <MemberPurchases gymId="g1" gym={gym} entryId="e1" name="Maya Patel" past={false} />
    </MemoryRouter>,
  );
const pressReceipt = async () => {
  const row = (await screen.findAllByTestId('purchase-row'))[0];
  fireEvent.click(within(row).getByRole('button', { name: 'View receipt #7 for 2 × Water' }));
  return row;
};

afterEach(() => {
  cleanup();
  // Reset, not clear: a value queued for one test must never be read by the next.
  vi.resetAllMocks();
  document.body.className = '';
});

describe('a receipt', () => {
  it('opens under the row pressed, says what was bought and paid, and closes', async () => {
    svc.purchases.mockResolvedValue({ sales: [sale()], notShown: 0 });
    svc.receipt.mockResolvedValue(receipt());
    open();
    const row = await pressReceipt();
    const paper = await within(row).findByTestId('receipt');
    expect(svc.receipt).toHaveBeenCalledWith('g1', 7);
    expect(within(row).getByRole('button', { name: 'View receipt #7 for 2 × Water' }).getAttribute('aria-expanded')).toBe('true');
    expect(paper.textContent).toContain('Iron House');
    expect(paper.textContent).toContain('Receipt #7');
    expect(paper.textContent).toContain('15 Oct 2026');
    expect(paper.textContent).toContain('For: Maya Patel');
    expect(within(paper).getByTestId('receipt-lines').textContent).toBe(
      '2 × Water at $2.50 each$5.00Discount: Staff 20−$1.00Sales tax 8.25%$0.33Total$4.33Paid by cash$4.33',
    );
    expect(paper.textContent).toContain('Taken by Sam Desk.');
    expect(screen.queryByTestId('receipt-no-address')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('receipt-box')).toBeNull();
  });

  it('Print sends the receipt, laid out as a page of its own, to the printer, and nothing of the console', async () => {
    svc.purchases.mockResolvedValue({ sales: [sale()], notShown: 0 });
    svc.receipt.mockResolvedValue(receipt());
    open();
    const row = await pressReceipt();
    await within(row).findByTestId('receipt');
    fireEvent.click(within(row).getByRole('button', { name: 'Print' }));
    expect(printHtml).toHaveBeenCalledTimes(1);
    const html = printHtml.mock.calls[0][0];
    for (const words of ['Iron House', '12 High Street', 'Receipt no.', '>7<', '15 Oct 2026', 'Maya Patel', '2 × Water at $2.50 each', '$4.33', 'Paid by cash', 'Thank you.']) expect(html).toContain(words);
    for (const console of ['View receipt', 'Bought at the desk', 'Close', 'c-btn']) expect(html).not.toContain(console);
  });

  it('a sale voided reads Voided on its receipt', async () => {
    svc.purchases.mockResolvedValue({ sales: [sale({ undone: true, voided: { reason: 'returned', on: '2026-10-12', by: 'Sam Owner' }, canUndo: false })], notShown: 0 });
    svc.receipt.mockResolvedValue(receipt({ cancelled: true }));
    open();
    const row = await pressReceipt();
    expect((await within(row).findByTestId('receipt-cancelled')).textContent).toBe('Voided. This sale was voided, so nothing was paid on it.');
  });

  it('a gym with no address: the owner types it in the box, and the receipt is read again with it', async () => {
    svc.purchases.mockResolvedValue({ sales: [sale()], notShown: 0 });
    svc.receipt.mockResolvedValueOnce(receipt({ gym: { name: 'Iron House', address: null } })).mockResolvedValueOnce(receipt({ gym: { name: 'Iron House', address: '9 Mill Lane' } }));
    updateOrg.mockResolvedValue({});
    open(OWNER);
    const row = await pressReceipt();
    const ask = await within(row).findByTestId('receipt-no-address');
    expect(ask.textContent).toContain("Your gym's address is not on its receipts yet.");
    fireEvent.change(within(ask).getByLabelText('Postal address'), { target: { value: '9 Mill Lane' } });
    fireEvent.click(within(ask).getByRole('button', { name: /Save/ }));
    expect(await within(row).findByText('9 Mill Lane', { selector: 'p' })).toBeTruthy();
    expect(updateOrg).toHaveBeenCalledWith('g1', { postalAddress: '9 Mill Lane' });
    expect(svc.receipt).toHaveBeenCalledTimes(2);
    expect(within(row).queryByTestId('receipt-no-address')).toBeNull();
  });

  it('a gym with no address: staff who cannot add it are told who can, with nothing to type', async () => {
    svc.purchases.mockResolvedValue({ sales: [sale()], notShown: 0 });
    svc.receipt.mockResolvedValue(receipt({ gym: { name: 'Iron House', address: null } }));
    open(DESK);
    const row = await pressReceipt();
    const ask = await within(row).findByTestId('receipt-no-address');
    expect(ask.textContent).toBe("Your gym's address is not on its receipts yet.The owner can add it in Gym details.");
    expect(within(ask).queryByRole('textbox')).toBeNull();
  });

  it('a receipt that cannot be read says so where it was asked for; Try again says it is reading, then shows it', async () => {
    svc.purchases.mockResolvedValue({ sales: [sale()], notShown: 0 });
    let answer;
    svc.receipt.mockRejectedValueOnce(Object.assign(new Error('down'), { response: { status: 500, data: {} } })).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    open();
    const row = await pressReceipt();
    expect((await within(row).findByRole('alert')).textContent).toBe("We couldn't open this receipt. Try again.");
    fireEvent.click(within(row).getByRole('button', { name: 'Try again' }));
    expect(within(row).getByText('Opening the receipt…')).toBeTruthy();
    expect(within(row).queryByRole('alert')).toBeNull();
    answer(receipt());
    expect(await within(row).findByTestId('receipt')).toBeTruthy();
  });
});
